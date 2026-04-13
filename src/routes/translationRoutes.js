const express = require('express');
const multer = require('multer');
const path = require('path');
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

async function saveHistory(record) {
  if (!isDbReady()) return;
  await TranslationHistory.create(record);
}

router.post('/translate', upload.single('document'), async (req, res, next) => {
  const { sourceLanguage, targetLanguage, project = 'default', domain = 'general' } = req.body;

  if (!req.file) {
    return res.status(400).json({ error: 'Debes enviar un archivo en el campo document.' });
  }

  if (!sourceLanguage || !targetLanguage) {
    return res.status(400).json({ error: 'sourceLanguage y targetLanguage son obligatorios.' });
  }

  try {
    const originalText = await extractTextByFile(req.file, sourceLanguage);
    const memory = await getMemoryContext({ project, domain, sourceLanguage, targetLanguage });

    const preRuledText = applyRules(originalText, memory.preRules);
    const { text: textWithPlaceholders, placeholders } = applyGlossaryPlaceholders(preRuledText, memory.glossary);

    let translatedText = await translateText(textWithPlaceholders, sourceLanguage, targetLanguage);
    translatedText = restoreGlossaryPlaceholders(translatedText, placeholders);
    translatedText = applyRules(translatedText, memory.postRules);
    translatedText = applyCorrections(translatedText, memory.corrections);

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
});

module.exports = router;
