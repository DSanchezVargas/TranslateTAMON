const express = require('express');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const { pool, isDbReady } = require('../config/db');
const { sanitizeString } = require('../utils/validation');

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

const router = express.Router();
const memoryRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes. Intenta en un minuto.' }
});

function resolveUserId(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      return Number(decoded.id);
    } catch (e) {
      return null;
    }
  }
  return Number(req.user?.id || req.user?._id || null);
}

function requireDb(req, res, next) {
  if (process.env.NODE_ENV === 'test') {
    return next();
  }
  if (!isDbReady()) {
    return res.status(503).json({ error: 'Base de datos no disponible.' });
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
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Sesión no válida o token ausente.' });
    }
    
    const query = `
      SELECT id, project, source_language AS "sourceLanguage", target_language AS "targetLanguage", 
             source_term AS "sourceTerm", target_term AS "targetTerm", created_at AS "createdAt"
      FROM glossary_entries 
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [userId]);
    return res.json(result.rows);
  } catch (error) {
    return next(error);
  }
});

router.post('/glossary', memoryRateLimiter, requireDb, async (req, res, next) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Sesión no válida o token ausente.' });
    }

    const project = sanitizeString(req.body.project || 'default', { required: true, maxLength: 120 });
    const sourceLanguage = sanitizeString(req.body.sourceLanguage || 'en', { required: true, maxLength: 20 });
    const targetLanguage = sanitizeString(req.body.targetLanguage || 'es', { required: true, maxLength: 20 });
    const sourceTerm = sanitizeString(req.body.sourceTerm, { required: true, maxLength: 300 });
    const targetTerm = sanitizeString(req.body.targetTerm, { required: true, maxLength: 300 });

    const query = `
      INSERT INTO glossary_entries (user_id, project, source_language, target_language, source_term, target_term)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, project, source_language AS "sourceLanguage", target_language AS "targetLanguage", 
                source_term AS "sourceTerm", target_term AS "targetTerm", created_at AS "createdAt"
    `;
    const result = await pool.query(query, [userId, project, sourceLanguage, targetLanguage, sourceTerm, targetTerm]);
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return next(error);
  }
});

router.delete('/glossary/:id', memoryRateLimiter, requireDb, async (req, res, next) => {
  try {
    const userId = resolveUserId(req);
    if (!userId) {
      return res.status(401).json({ error: 'Sesión no válida o token ausente.' });
    }

    const entryId = Number(req.params.id);
    if (!entryId) {
      return res.status(400).json({ error: 'ID de término no válido.' });
    }

    const query = 'DELETE FROM glossary_entries WHERE id = $1 AND user_id = $2 RETURNING *';
    const result = await pool.query(query, [entryId, userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Término no encontrado o no autorizado para borrar.' });
    }
    
    return res.json({ message: 'Término eliminado físicamente de la base de datos.', deleted: result.rows[0] });
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

router.post('/rules', memoryRateLimiter, requireAdmin, requireDb, async (req, res, next) => {
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
