const express = require('express');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { extractTextByFile } = require('../services/textExtractor');
const { translateText } = require('../services/translator');
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
const { sanitizeString } = require('../utils/validation');
const { ASSISTANT_TAGLINE } = require('../config/appInfo');

const router = express.Router();
const uploadLimitMb = Math.max(Number(process.env.MAX_UPLOAD_MB) || 100, 1);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadLimitMb * 1024 * 1024 }
});
const previewStore = new Map();
const PREVIEW_TTL_MS = 30 * 60 * 1000;
const MAX_ESTIMATED_SECONDS = 23 * 60 * 60;

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

  return TranslationHistory.findOne({
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
    return next(error);
  }
});

module.exports = router;
