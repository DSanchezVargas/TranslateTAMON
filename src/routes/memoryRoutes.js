const express = require('express');
const rateLimit = require('express-rate-limit');
const { isDbReady } = require('../config/db');
const GlossaryEntry = require('../models/GlossaryEntry');
const UserCorrection = require('../models/UserCorrection');
const DomainRule = require('../models/DomainRule');
const CorrectionSuggestion = require('../models/CorrectionSuggestion');
const { sanitizeString } = require('../utils/validation');

const router = express.Router();
const memoryRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta en un minuto.' }
});

function requireDb(req, res, next) {
  void req;
  if (!isDbReady()) {
    return res.status(503).json({ error: 'MongoDB no está conectado. Configura MONGO_URI.' });
  }
  return next();
}

function requireAdmin(req, res, next) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) {
    return res.status(503).json({ error: 'ADMIN_TOKEN no configurado.' });
  }

  if (req.headers['x-admin-token'] !== adminToken) {
    return res.status(403).json({ error: 'Solo admin puede realizar esta acción.' });
  }

  return next();
}

router.get('/glossary', memoryRateLimiter, requireDb, async (req, res, next) => {
  try {
    const { project, sourceLanguage, targetLanguage } = req.query;
    const entries = await GlossaryEntry.find({
      project: sanitizeString(project, { required: true, maxLength: 120 }),
      sourceLanguage: sanitizeString(sourceLanguage, { required: true, maxLength: 20 }),
      targetLanguage: sanitizeString(targetLanguage, { required: true, maxLength: 20 })
    }).lean();
    return res.json(entries);
  } catch (error) {
    return next(error);
  }
});

router.post('/glossary', memoryRateLimiter, requireDb, async (req, res, next) => {
  try {
    const created = await GlossaryEntry.create({
      project: sanitizeString(req.body.project, { required: true, maxLength: 120 }),
      sourceLanguage: sanitizeString(req.body.sourceLanguage, { required: true, maxLength: 20 }),
      targetLanguage: sanitizeString(req.body.targetLanguage, { required: true, maxLength: 20 }),
      sourceTerm: sanitizeString(req.body.sourceTerm, { required: true, maxLength: 300 }),
      targetTerm: sanitizeString(req.body.targetTerm, { required: true, maxLength: 300 })
    });
    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

router.get('/corrections', memoryRateLimiter, requireDb, async (req, res, next) => {
  try {
    const { project, sourceLanguage, targetLanguage } = req.query;
    const entries = await UserCorrection.find({
      project: sanitizeString(project, { required: true, maxLength: 120 }),
      sourceLanguage: sanitizeString(sourceLanguage, { required: true, maxLength: 20 }),
      targetLanguage: sanitizeString(targetLanguage, { required: true, maxLength: 20 })
    }).lean();
    return res.json(entries);
  } catch (error) {
    return next(error);
  }
});

router.post('/corrections', memoryRateLimiter, requireAdmin, requireDb, async (req, res, next) => {
  try {
    const created = await UserCorrection.create({
      project: sanitizeString(req.body.project, { required: true, maxLength: 120 }),
      sourceLanguage: sanitizeString(req.body.sourceLanguage, { required: true, maxLength: 20 }),
      targetLanguage: sanitizeString(req.body.targetLanguage, { required: true, maxLength: 20 }),
      originalTranslation: sanitizeString(req.body.originalTranslation, { required: true, maxLength: 2000 }),
      correctedTranslation: sanitizeString(req.body.correctedTranslation, { required: true, maxLength: 2000 }),
      createdByRole: 'admin'
    });
    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

router.post('/corrections/suggestions', memoryRateLimiter, requireDb, async (req, res, next) => {
  try {
    const created = await CorrectionSuggestion.create({
      project: sanitizeString(req.body.project, { required: true, maxLength: 120 }),
      sourceLanguage: sanitizeString(req.body.sourceLanguage, { required: true, maxLength: 20 }),
      targetLanguage: sanitizeString(req.body.targetLanguage, { required: true, maxLength: 20 }),
      originalTranslation: sanitizeString(req.body.originalTranslation, { required: true, maxLength: 2000 }),
      suggestedTranslation: sanitizeString(req.body.suggestedTranslation, { required: true, maxLength: 2000 })
    });
    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

router.post('/corrections/suggestions/:id/approve', memoryRateLimiter, requireAdmin, requireDb, async (req, res, next) => {
  try {
    const suggestion = await CorrectionSuggestion.findById(req.params.id);
    if (!suggestion) {
      return res.status(404).json({ error: 'Sugerencia no encontrada.' });
    }

    suggestion.status = 'approved';
    suggestion.reviewedBy = 'admin';
    await suggestion.save();

    const correction = await UserCorrection.create({
      project: suggestion.project,
      sourceLanguage: suggestion.sourceLanguage,
      targetLanguage: suggestion.targetLanguage,
      originalTranslation: suggestion.originalTranslation,
      correctedTranslation: suggestion.suggestedTranslation,
      createdByRole: 'admin'
    });

    return res.status(201).json(correction);
  } catch (error) {
    return next(error);
  }
});

router.get('/rules', memoryRateLimiter, requireDb, async (req, res, next) => {
  try {
    const { project, domain } = req.query;
    const entries = await DomainRule.find({
      project: sanitizeString(project, { required: true, maxLength: 120 }),
      domain: sanitizeString(domain, { required: true, maxLength: 120 })
    }).lean();
    return res.json(entries);
  } catch (error) {
    return next(error);
  }
});

router.post('/rules', memoryRateLimiter, requireDb, async (req, res, next) => {
  try {
    const created = await DomainRule.create({
      project: sanitizeString(req.body.project, { required: true, maxLength: 120 }),
      domain: sanitizeString(req.body.domain, { required: true, maxLength: 120 }),
      findText: sanitizeString(req.body.findText, { required: true, maxLength: 2000 }),
      replaceText: sanitizeString(req.body.replaceText, { required: true, maxLength: 2000 }),
      applyStage: sanitizeString(req.body.applyStage, { required: false, maxLength: 30 }) || 'pre_translation'
    });
    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
