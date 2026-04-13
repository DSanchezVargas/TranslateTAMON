const express = require('express');
const { isDbReady } = require('../config/db');
const GlossaryEntry = require('../models/GlossaryEntry');
const UserCorrection = require('../models/UserCorrection');
const DomainRule = require('../models/DomainRule');
const CorrectionSuggestion = require('../models/CorrectionSuggestion');

const router = express.Router();

function requireDb(_, res, next) {
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

router.get('/glossary', requireDb, async (req, res, next) => {
  try {
    const { project, sourceLanguage, targetLanguage } = req.query;
    const entries = await GlossaryEntry.find({ project, sourceLanguage, targetLanguage }).lean();
    return res.json(entries);
  } catch (error) {
    return next(error);
  }
});

router.post('/glossary', requireDb, async (req, res, next) => {
  try {
    const created = await GlossaryEntry.create(req.body);
    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

router.get('/corrections', requireDb, async (req, res, next) => {
  try {
    const { project, sourceLanguage, targetLanguage } = req.query;
    const entries = await UserCorrection.find({ project, sourceLanguage, targetLanguage }).lean();
    return res.json(entries);
  } catch (error) {
    return next(error);
  }
});

router.post('/corrections', requireAdmin, requireDb, async (req, res, next) => {
  try {
    const created = await UserCorrection.create({
      ...req.body,
      createdByRole: 'admin'
    });
    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

router.post('/corrections/suggestions', requireDb, async (req, res, next) => {
  try {
    const created = await CorrectionSuggestion.create(req.body);
    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

router.post('/corrections/suggestions/:id/approve', requireAdmin, requireDb, async (req, res, next) => {
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

router.get('/rules', requireDb, async (req, res, next) => {
  try {
    const { project, domain } = req.query;
    const entries = await DomainRule.find({ project, domain }).lean();
    return res.json(entries);
  } catch (error) {
    return next(error);
  }
});

router.post('/rules', requireDb, async (req, res, next) => {
  try {
    const created = await DomainRule.create(req.body);
    return res.status(201).json(created);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
