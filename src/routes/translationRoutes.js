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
const { ASSISTANT_TAGLINE } = require('../config/appInfo');

const router = express.Router();
const DEFAULT_UPLOAD_LIMIT_MB = 100;
const uploadLimitMb = Math.max(Number(process.env.MAX_UPLOAD_MB) || DEFAULT_UPLOAD_LIMIT_MB, 1);
if (!process.env.MAX_UPLOAD_MB && process.env.NODE_ENV !== 'test') {
  console.warn(`MAX_UPLOAD_MB no configurado. Se usa valor por defecto: ${DEFAULT_UPLOAD_LIMIT_MB}MB`);
}
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadLimitMb * 1024 * 1024 }
});
const previewStore = new Map();
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_ESTIMATED_SECONDS = 23 * 60 * 60;
const ASSISTANT_TEXT_PREVIEW_LIMIT = 220;

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

function buildAssistantMessage(status) {
  return `${ASSISTANT_TAGLINE} · status: ${status}`;
}

function setExperienceHeaders(res, { traceId, status, processingMs }) {
  res.setHeader('X-Tamon-Trace-Id', traceId);
  res.setHeader('X-Tamon-Status', status);
  res.setHeader('X-Tamon-Processing-Ms', String(processingMs));
  res.setHeader('X-Tamon-Assistant-Message', buildAssistantMessage(status));
}

function estimateTranslationSecondsByText(text = '') {
  const estimated = Math.ceil(text.length / 900);
  return Math.min(Math.max(estimated, 10), MAX_ESTIMATED_SECONDS);
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
    const chunkWarnings = [];
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
      },
      fallbackToOriginalOnError: true,
      onChunkError: ({ chunkIndex, totalChunks, message }) => {
        chunkWarnings.push({ chunkIndex, totalChunks, message });
        job.message = `Bloque ${chunkIndex + 1}/${totalChunks} con error, continuando...`;
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
    job.message = chunkWarnings.length
      ? `Vista previa lista con ${chunkWarnings.length} bloque(s) sin traducir por limite externo.`
      : 'Vista previa lista.';
    job.previewId = previewId;
    job.translatedTextPartial = translatedText;
    addJobHistory(job, chunkWarnings.length
      ? `Traduccion finalizada con advertencias (${chunkWarnings.length} bloque(s)).`
      : 'Traduccion finalizada correctamente.');
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
  const startedAt = Date.now();
  const traceId = crypto.randomUUID();
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

    const { originalText, translatedText, sourceTextHash, fromCache } = await createPreviewFromFile({
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
      const processingMs = Date.now() - startedAt;
      setExperienceHeaders(res, { traceId, status: 'preview_ready', processingMs });
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
        traceId,
        originalFileName: req.file.originalname,
        sourceLanguage,
        targetLanguage,
        originalText,
        translatedText,
        experience: {
          status: 'preview_ready',
          processingMs,
          estimatedCompletionSeconds: estimateTranslationSecondsByText(originalText),
          fromCache,
          progress: {
            completionPercent: 100,
            stage: 'preview_ready'
          },
          assistantMessage: buildAssistantMessage('preview_ready')
        }
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
    const processingMs = Date.now() - startedAt;

    setExperienceHeaders(res, { traceId, status: 'document_ready', processingMs });
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
  const startedAt = Date.now();
  const traceId = crypto.randomUUID();
  try {
    const previewId = req.body.previewId ? sanitizeString(req.body.previewId, { maxLength: 120 }) : undefined;
    const translatedText = req.body.translatedText
      ? sanitizeString(req.body.translatedText, { maxLength: null })
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
    const processingMs = Date.now() - startedAt;

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

    setExperienceHeaders(res, { traceId, status: 'finalized', processingMs });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    return res.status(200).send(translatedDocxBuffer);
  } catch (error) {
    if (
      error.message.includes('Campo ')
      || error.message.includes('Formato de campo inválido')
    ) {
      error.status = 400;
    }
    return next(error);
  }
});

router.post('/assistant/translate-text', async (req, res, next) => {
  const startedAt = Date.now();
  const traceId = crypto.randomUUID();
  try {
    const text = sanitizeString(req.body.text, { required: true, maxLength: 12000 });
    const sourceLanguage = sanitizeString(req.body.sourceLanguage, { required: true, maxLength: 20 });
    const targetLanguage = sanitizeString(req.body.targetLanguage, { required: true, maxLength: 20 });
    const userName = sanitizeString(req.body.userName || 'usuario', { required: true, maxLength: 80 });

    const translatedText = await translateText(text, sourceLanguage, targetLanguage);
    const translatedTextPreview = translatedText.length > ASSISTANT_TEXT_PREVIEW_LIMIT
      ? `${translatedText.slice(0, ASSISTANT_TEXT_PREVIEW_LIMIT)}...`
      : translatedText;
    const processingMs = Date.now() - startedAt;

    await saveHistory({
      originalFileName: 'quick-text-input.txt',
      fileType: 'txt',
      sourceLanguage,
      targetLanguage,
      project: 'assistant-chat',
      domain: 'general',
      sourceTextHash: computeSourceHash(text),
      translatedTextCache: translatedText,
      sourceTextLength: text.length,
      translatedTextLength: translatedText.length,
      status: 'success'
    });

    setExperienceHeaders(res, { traceId, status: 'text_translation_ready', processingMs });
    return res.status(200).json({
      traceId,
      userName,
      sourceLanguage,
      targetLanguage,
      translatedText,
      assistantResponse: `Bueno ${userName}, tu traducción a ${targetLanguage} es: ${translatedTextPreview}`,
      learningState: 'Tamon está aprendiendo y mejora en cada interacción.'
    });
  } catch (error) {
    if (
      error.message.includes('Campo ')
      || error.message.includes('Formato de campo inválido')
    ) {
      error.status = 400;
    }
    return next(error);
  }
});

module.exports = router;
