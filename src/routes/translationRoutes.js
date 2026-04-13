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

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});
const previewStore = new Map();
const PREVIEW_TTL_MS = 30 * 60 * 1000;

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

async function createPreviewFromFile({ file, sourceLanguage, targetLanguage, project, domain }) {
  const originalText = await extractTextByFile(file, sourceLanguage);
  const memory = await getMemoryContext({ project, domain, sourceLanguage, targetLanguage });

  const preRuledText = applyRules(originalText, memory.preRules);
  const { text: textWithPlaceholders, placeholders } = applyGlossaryPlaceholders(preRuledText, memory.glossary);

  let translatedText = await translateText(textWithPlaceholders, sourceLanguage, targetLanguage);
  translatedText = restoreGlossaryPlaceholders(translatedText, placeholders);
  translatedText = applyRules(translatedText, memory.postRules);
  translatedText = applyCorrections(translatedText, memory.corrections);

  return { originalText, translatedText };
}

async function processTranslationRequest(req, res, next, returnPreviewOnly = false) {
  const { sourceLanguage, targetLanguage, project = 'default', domain = 'general' } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'Debes enviar un archivo en el campo document.' });
  }

  if (!sourceLanguage || !targetLanguage) {
    return res.status(400).json({ error: 'sourceLanguage y targetLanguage son obligatorios.' });
  }

  try {
    const { originalText, translatedText } = await createPreviewFromFile({
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
      translatedText,
      expiresAt: Date.now() + PREVIEW_TTL_MS
    });

    if (returnPreviewOnly) {
      await saveHistory({
        originalFileName: req.file.originalname,
        fileType: path.extname(req.file.originalname).replace('.', ''),
        sourceLanguage,
        targetLanguage,
        project,
        domain,
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

router.post('/translate/finalize', async (req, res, next) => {
  try {
    const { previewId, translatedText, sourceLanguage, targetLanguage, originalFileName } = req.body;

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

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`);
    return res.status(200).send(translatedDocxBuffer);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
