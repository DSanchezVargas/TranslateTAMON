const express = require('express');
const { isDbReady } = require('../config/db');
const GlossaryEntry = require('../models/GlossaryEntry');
const UserCorrection = require('../models/UserCorrection');
const DomainRule = require('../models/DomainRule');

const router = express.Router();

function requireDb(_, res, next) {
  if (!isDbReady()) {
    return res.status(503).json({ error: 'MongoDB no está conectado. Configura MONGO_URI.' });
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

router.post('/corrections', requireDb, async (req, res, next) => {
  try {
    const created = await UserCorrection.create(req.body);
    return res.status(201).json(created);
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
