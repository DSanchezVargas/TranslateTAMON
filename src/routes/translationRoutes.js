const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { extractTextByFile } = require('../services/textExtractor');
const { translateText, translateTextWithProgress } = require('../services/translator');
const { createTranslatedDocxBuffer } = require('../services/docxGenerator');
const {
  getMemoryContext,
  applyRules,
  applyGlossaryPlaceholders,
  restoreGlossaryPlaceholders,
  applyCorrections
} = require('../services/memoryService');
const { isDbReady } = require('../config/db');
const TranslationHistory = require('../models/TranslationHistory');
const CorrectionSuggestion = require('../models/CorrectionSuggestion');
const { sanitizeString } = require('../utils/validation');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});
const previewStore = new Map();
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const translationJobs = new Map();
const JOB_TTL_MS = 24 * 60 * 60 * 1000;

function isInvalidTranslatedText(text) {
  if (!text || typeof text !== 'string') return true;
  const upper = text.toUpperCase();
  return upper.includes('QUERY LENGTH LIMIT EXCEEDED') || upper.includes('MAX ALLOWED QUERY');
}

async function saveHistory(record) {
  if (!isDbReady()) return;
  await TranslationHistory.create(record);
}

function clearExpiredPreviews() {
  const now = Date.now();
  previewStore.forEach((preview, id) => {
    if (preview.expiresAt <= now) previewStore.delete(id);
  });
}
setInterval(clearExpiredPreviews, 5 * 60 * 1000).unref();

function clearExpiredJobs() {
  const now = Date.now();
  translationJobs.forEach((job, id) => {
    if (job.expiresAt <= now) translationJobs.delete(id);
  });
}
setInterval(clearExpiredJobs, 10 * 60 * 1000).unref();

function computeSourceHash(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function splitIntoParagraphs(text) {
  return (text || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getAutoLearningPairs(originalTranslatedText, userFinalText) {
  const originalParagraphs = splitIntoParagraphs(originalTranslatedText);
  const finalParagraphs = splitIntoParagraphs(userFinalText);
  const maxLength = Math.min(originalParagraphs.length, finalParagraphs.length);
  const pairs = [];

  for (let index = 0; index < maxLength; index += 1) {
    const originalParagraph = originalParagraphs[index];
    const finalParagraph = finalParagraphs[index];

    if (!originalParagraph || !finalParagraph) continue;
    if (originalParagraph === finalParagraph) continue;

    // Mantiene sugerencias compactas para memoria accionable y revisión admin.
    if (originalParagraph.length > 2000 || finalParagraph.length > 2000) continue;

    pairs.push({ originalParagraph, finalParagraph });
  }

  return pairs.slice(0, 50);
}

async function saveUserLearningSuggestions(preview, userFinalText) {
  if (!isDbReady()) return;
  if (!preview?.translatedText || !userFinalText) return;
  if (preview.translatedText === userFinalText) return;

  const pairs = getAutoLearningPairs(preview.translatedText, userFinalText);
  if (!pairs.length) return;

  const operations = pairs.map(({ originalParagraph, finalParagraph }) => {
    return CorrectionSuggestion.findOneAndUpdate(
      {
        project: preview.project,
        sourceLanguage: preview.sourceLanguage,
        targetLanguage: preview.targetLanguage,
        originalTranslation: originalParagraph,
        suggestedTranslation: finalParagraph,
        status: 'pending'
      },
      {
        $setOnInsert: {
          project: preview.project,
          sourceLanguage: preview.sourceLanguage,
          targetLanguage: preview.targetLanguage,
          originalTranslation: originalParagraph,
          suggestedTranslation: finalParagraph,
          status: 'pending',
          reviewedBy: undefined
        }
      },
      { upsert: true, new: false }
    );
  });

  await Promise.all(operations);
}

async function findCachedTranslation({ sourceHash, sourceLanguage, targetLanguage, project, domain }) {
  if (!isDbReady()) return null;

  const cached = await TranslationHistory.findOne({
    sourceTextHash: sourceHash,
    sourceLanguage,
    targetLanguage,
    project,
    domain,
    status: 'success',
    translatedTextCache: { $exists: true, $ne: '' }
  })
    .sort({ updatedAt: -1 })
    .lean();

  if (!cached?.translatedTextCache) return null;
  if (isInvalidTranslatedText(cached.translatedTextCache)) return null;

  return cached;
}

function createJob({ originalFileName, sourceLanguage, targetLanguage, project, domain }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const job = {
    id,
    status: 'queued',
    progressPercent: 0,
    etaSeconds: null,
    message: 'Trabajo en cola.',
    error: null,
    startedAt: now,
    updatedAt: now,
    expiresAt: now + JOB_TTL_MS,
    originalFileName,
    sourceLanguage,
    targetLanguage,
    project,
    domain,
    previewId: null,
    translatedTextPartial: '',
    history: [{ at: now, progressPercent: 0, message: 'Trabajo creado.' }]
  };

  translationJobs.set(id, job);
  return job;
}

function touchJob(job) {
  job.updatedAt = Date.now();
  job.expiresAt = Date.now() + JOB_TTL_MS;
}

function addJobHistory(job, message) {
  job.history.push({ at: Date.now(), progressPercent: job.progressPercent, message });
  if (job.history.length > 30) {
    job.history = job.history.slice(job.history.length - 30);
  }
  touchJob(job);
}

function estimateEtaSeconds(startedAt, processedChunks, totalChunks) {
  if (!processedChunks || !totalChunks || processedChunks >= totalChunks) return 0;
  const elapsedSeconds = (Date.now() - startedAt) / 1000;
  const avgPerChunk = elapsedSeconds / processedChunks;
  const remaining = Math.ceil((totalChunks - processedChunks) * avgPerChunk);
  return Math.min(Math.max(remaining, 0), 86399);
}

async function runPreviewJob(job, { file, sourceLanguage, targetLanguage, project, domain }) {
  job.status = 'processing';
  job.message = 'Extrayendo texto del documento...';
  job.progressPercent = 5;
  addJobHistory(job, 'Extraccion iniciada.');

  try {
    const originalText = await extractTextByFile(file, sourceLanguage);
    const sourceTextHash = computeSourceHash(originalText);

    job.message = 'Buscando traduccion previa en memoria...';
    job.progressPercent = 12;
    touchJob(job);

    const cached = await findCachedTranslation({
      sourceHash: sourceTextHash,
      sourceLanguage,
      targetLanguage,
      project,
      domain
    });

    if (cached?.translatedTextCache) {
      const previewId = crypto.randomUUID();
      clearExpiredPreviews();
      previewStore.set(previewId, {
        originalFileName: file.originalname,
        sourceLanguage,
        targetLanguage,
        project,
        domain,
        originalText,
        sourceTextHash,
        translatedText: cached.translatedTextCache,
        expiresAt: Date.now() + PREVIEW_TTL_MS
      });

      job.status = 'completed';
      job.progressPercent = 100;
      job.etaSeconds = 0;
      job.message = 'Completado desde cache.';
      job.previewId = previewId;
      job.translatedTextPartial = cached.translatedTextCache;
      addJobHistory(job, 'Resultado obtenido desde cache.');

      await saveHistory({
        originalFileName: file.originalname,
        fileType: path.extname(file.originalname).replace('.', ''),
        sourceLanguage,
        targetLanguage,
        project,
        domain,
        sourceTextHash,
        translatedTextCache: cached.translatedTextCache,
        sourceTextLength: originalText.length,
        translatedTextLength: cached.translatedTextCache.length,
        status: 'success'
      });

      return;
    }

    job.message = 'Cargando reglas y memoria del proyecto...';
    job.progressPercent = 18;
    touchJob(job);

    const memory = await getMemoryContext({ project, domain, sourceLanguage, targetLanguage });
    const preRuledText = applyRules(originalText, memory.preRules);
    const { text: textWithPlaceholders, placeholders } = applyGlossaryPlaceholders(preRuledText, memory.glossary);

    job.message = 'Traduciendo bloques del documento...';
    job.progressPercent = 20;
    addJobHistory(job, 'Traduccion iniciada.');

    const translatedRaw = await translateTextWithProgress(textWithPlaceholders, sourceLanguage, targetLanguage, {
      onProgress: ({ processedChunks, totalChunks, translatedSoFar }) => {
        const progressInTranslation = Math.round((processedChunks / totalChunks) * 70);
        job.progressPercent = 20 + progressInTranslation;
        job.etaSeconds = estimateEtaSeconds(job.startedAt, processedChunks, totalChunks);
        job.message = `Traduciendo bloque ${processedChunks} de ${totalChunks}...`;
        job.translatedTextPartial = translatedSoFar;
        touchJob(job);
      }
    });

    job.message = 'Aplicando reglas finales y correcciones...';
    job.progressPercent = 94;
    touchJob(job);

    let translatedText = restoreGlossaryPlaceholders(translatedRaw, placeholders);
    translatedText = applyRules(translatedText, memory.postRules);
    translatedText = applyCorrections(translatedText, memory.corrections);

    if (isInvalidTranslatedText(translatedText)) {
      throw new Error('El proveedor devolvio contenido invalido en el resultado final.');
    }

    const previewId = crypto.randomUUID();
    clearExpiredPreviews();
    previewStore.set(previewId, {
      originalFileName: file.originalname,
      sourceLanguage,
      targetLanguage,
      project,
      domain,
      originalText,
      sourceTextHash,
      translatedText,
      expiresAt: Date.now() + PREVIEW_TTL_MS
    });

    await saveHistory({
      originalFileName: file.originalname,
      fileType: path.extname(file.originalname).replace('.', ''),
      sourceLanguage,
      targetLanguage,
      project,
      domain,
      sourceTextHash,
      translatedTextCache: translatedText,
      sourceTextLength: originalText.length,
      translatedTextLength: translatedText.length,
      status: 'success'
    });

    job.status = 'completed';
    job.progressPercent = 100;
    job.etaSeconds = 0;
    job.message = 'Vista previa lista.';
    job.previewId = previewId;
    job.translatedTextPartial = translatedText;
    addJobHistory(job, 'Traduccion finalizada correctamente.');
  } catch (error) {
    job.status = 'failed';
    job.progressPercent = 100;
    job.etaSeconds = null;
    job.message = 'Trabajo finalizado con error.';
    job.error = error.message;
    addJobHistory(job, `Error: ${error.message}`);

    await saveHistory({
      originalFileName: file?.originalname || 'unknown',
      fileType: path.extname(file?.originalname || '').replace('.', ''),
      sourceLanguage,
      targetLanguage,
      project,
      domain,
      sourceTextLength: 0,
      translatedTextLength: 0,
      status: 'failed',
      errorMessage: error.message
    });
  }
}

async function createPreviewFromFile({ file, sourceLanguage, targetLanguage, project, domain }) {
  const originalText = await extractTextByFile(file, sourceLanguage);
  const sourceTextHash = computeSourceHash(originalText);
  const cached = await findCachedTranslation({
    sourceHash: sourceTextHash,
    sourceLanguage,
    targetLanguage,
    project,
    domain
  });

  if (cached?.translatedTextCache) {
    return { originalText, translatedText: cached.translatedTextCache, sourceTextHash, fromCache: true };
  }

  const memory = await getMemoryContext({ project, domain, sourceLanguage, targetLanguage });

  const preRuledText = applyRules(originalText, memory.preRules);
  const { text: textWithPlaceholders, placeholders } = applyGlossaryPlaceholders(preRuledText, memory.glossary);

  let translatedText = await translateText(textWithPlaceholders, sourceLanguage, targetLanguage);
  translatedText = restoreGlossaryPlaceholders(translatedText, placeholders);
  translatedText = applyRules(translatedText, memory.postRules);
  translatedText = applyCorrections(translatedText, memory.corrections);

  if (isInvalidTranslatedText(translatedText)) {
    throw new Error('El proveedor de traduccion devolvio un texto invalido por limite de longitud. Intenta de nuevo.');
  }

  return { originalText, translatedText, sourceTextHash, fromCache: false };
}

async function processTranslationRequest(req, res, next, shouldReturnPreview = false) {
  let sourceLanguage;
  let targetLanguage;
  let project;
  let domain;

  if (!req.file) {
    return res.status(400).json({ error: 'Debes enviar un archivo en el campo document.' });
  }

  try {
    sourceLanguage = sanitizeString(req.body.sourceLanguage, { required: true, maxLength: 20 });
    targetLanguage = sanitizeString(req.body.targetLanguage, { required: true, maxLength: 20 });
    project = sanitizeString(req.body.project || 'default', { required: true, maxLength: 120 });
    domain = sanitizeString(req.body.domain || 'general', { required: true, maxLength: 120 });

    const { originalText, translatedText, sourceTextHash } = await createPreviewFromFile({
      file: req.file,
      sourceLanguage,
      targetLanguage,
      project,
      domain
    });

    const previewId = crypto.randomUUID();
    clearExpiredPreviews();
    previewStore.set(previewId, {
      originalFileName: req.file.originalname,
      sourceLanguage,
      targetLanguage,
      project,
      domain,
      originalText,
      sourceTextHash,
      translatedText,
      expiresAt: Date.now() + PREVIEW_TTL_MS
    });

    if (shouldReturnPreview) {
      await saveHistory({
        originalFileName: req.file.originalname,
        fileType: path.extname(req.file.originalname).replace('.', ''),
        sourceLanguage,
        targetLanguage,
        project,
        domain,
        sourceTextHash,
        translatedTextCache: translatedText,
        sourceTextLength: originalText.length,
        translatedTextLength: translatedText.length,
        status: 'success'
      });
      return res.status(200).json({
        previewId,
        originalFileName: req.file.originalname,
        sourceLanguage,
        targetLanguage,
        originalText,
        translatedText
      });
    }

    const translatedDocxBuffer = await createTranslatedDocxBuffer({
      originalFileName: req.file.originalname,
      sourceLanguage,
      targetLanguage,
      translatedText
    });

    await saveHistory({
      originalFileName: req.file.originalname,
      fileType: path.extname(req.file.originalname).replace('.', ''),
      sourceLanguage,
      targetLanguage,
      project,
      domain,
      sourceTextHash,
      translatedTextCache: translatedText,
      sourceTextLength: originalText.length,
      translatedTextLength: translatedText.length,
      status: 'success'
    });

    const baseName = path.parse(req.file.originalname).name;
    const outputName = `${baseName}-${targetLanguage}.docx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    return res.status(200).send(translatedDocxBuffer);
  } catch (error) {
    await saveHistory({
      originalFileName: req.file?.originalname || 'unknown',
      fileType: path.extname(req.file?.originalname || '').replace('.', ''),
      sourceLanguage,
      targetLanguage,
      project,
      domain,
      sourceTextLength: 0,
      translatedTextLength: 0,
      status: 'failed',
      errorMessage: error.message
    });

    return next(error);
  }
}

router.post('/translate', upload.single('document'), async (req, res, next) => {
  return processTranslationRequest(req, res, next, false);
});

router.post('/translate/preview', upload.single('document'), async (req, res, next) => {
  return processTranslationRequest(req, res, next, true);
});

router.post('/translate/preview/async', upload.single('document'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Debes enviar un archivo en el campo document.' });
    }

    const sourceLanguage = sanitizeString(req.body.sourceLanguage, { required: true, maxLength: 20 });
    const targetLanguage = sanitizeString(req.body.targetLanguage, { required: true, maxLength: 20 });
    const project = sanitizeString(req.body.project || 'default', { required: true, maxLength: 120 });
    const domain = sanitizeString(req.body.domain || 'general', { required: true, maxLength: 120 });

    const job = createJob({
      originalFileName: req.file.originalname,
      sourceLanguage,
      targetLanguage,
      project,
      domain
    });

    setImmediate(() => {
      void runPreviewJob(job, {
        file: req.file,
        sourceLanguage,
        targetLanguage,
        project,
        domain
      });
    });

    return res.status(202).json({
      jobId: job.id,
      status: job.status,
      progressPercent: job.progressPercent,
      statusUrl: `/api/translate/jobs/${job.id}`
    });
  } catch (error) {
    return next(error);
  }
});

router.get('/translate/jobs', (req, res) => {
  void req;
  const jobs = Array.from(translationJobs.values())
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 20)
    .map((job) => ({
      id: job.id,
      status: job.status,
      progressPercent: job.progressPercent,
      etaSeconds: job.etaSeconds,
      message: job.message,
      originalFileName: job.originalFileName,
      updatedAt: job.updatedAt
    }));

  return res.json(jobs);
});

router.get('/translate/jobs/:id', (req, res) => {
  const id = sanitizeString(req.params.id, { required: true, maxLength: 120 });
  const job = translationJobs.get(id);
  if (!job) {
    return res.status(404).json({ error: 'Trabajo no encontrado o expirado.' });
  }

  return res.json({
    id: job.id,
    status: job.status,
    progressPercent: job.progressPercent,
    etaSeconds: job.etaSeconds,
    message: job.message,
    error: job.error,
    previewId: job.previewId,
    originalFileName: job.originalFileName,
    sourceLanguage: job.sourceLanguage,
    targetLanguage: job.targetLanguage,
    translatedTextPartial: job.translatedTextPartial,
    history: job.history,
    startedAt: job.startedAt,
    updatedAt: job.updatedAt
  });
});

router.post('/translate/finalize', async (req, res, next) => {
  try {
    const previewId = req.body.previewId ? sanitizeString(req.body.previewId, { maxLength: 120 }) : undefined;
    const translatedText = req.body.translatedText
      ? sanitizeString(req.body.translatedText, { maxLength: 300000 })
      : undefined;
    const sourceLanguage = req.body.sourceLanguage
      ? sanitizeString(req.body.sourceLanguage, { maxLength: 20 })
      : undefined;
    const targetLanguage = req.body.targetLanguage
      ? sanitizeString(req.body.targetLanguage, { maxLength: 20 })
      : undefined;
    const originalFileName = req.body.originalFileName
      ? sanitizeString(req.body.originalFileName, { maxLength: 260 })
      : undefined;

    const preview = previewId ? previewStore.get(previewId) : null;
    if (previewId && !preview) {
      return res.status(404).json({ error: 'Vista previa no encontrada o expirada.' });
    }

    const finalText = translatedText || preview?.translatedText;
    const finalSourceLanguage = sourceLanguage || preview?.sourceLanguage;
    const finalTargetLanguage = targetLanguage || preview?.targetLanguage;
    const finalFileName = originalFileName || preview?.originalFileName || 'documento';

    if (!finalText || !finalSourceLanguage || !finalTargetLanguage) {
      return res.status(400).json({
        error: 'Debes enviar translatedText, sourceLanguage y targetLanguage o un previewId válido.'
      });
    }

    await saveUserLearningSuggestions(preview, finalText);

    const translatedDocxBuffer = await createTranslatedDocxBuffer({
      originalFileName: finalFileName,
      sourceLanguage: finalSourceLanguage,
      targetLanguage: finalTargetLanguage,
      translatedText: finalText
    });

    const baseName = path.parse(finalFileName).name;
    const outputName = `${baseName}-${finalTargetLanguage}.docx`;

    await saveHistory({
      originalFileName: finalFileName,
      fileType: path.extname(finalFileName).replace('.', ''),
      sourceLanguage: finalSourceLanguage,
      targetLanguage: finalTargetLanguage,
      project: preview?.project || 'default',
      domain: preview?.domain || 'general',
      sourceTextHash: preview?.sourceTextHash,
      translatedTextCache: finalText,
      sourceTextLength: preview?.originalText?.length || 0,
      translatedTextLength: finalText.length,
      status: 'success'
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    return res.status(200).send(translatedDocxBuffer);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
