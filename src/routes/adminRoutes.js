const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const CorrectionSuggestion = require('../models/CorrectionSuggestion');
const DomainRule = require('../models/DomainRule');
const GlossaryEntry = require('../models/GlossaryEntry');
const { pool, isDbReady } = require('../config/db');
const { normalizePlan } = require('../utils/planCatalog');

function normalizeUserRow(row) {
  return {
    id: row.id,
    nombre: row.nombre,
    correo: row.email,
    plan: normalizePlan(row.plan),
    role: row.role,
    status: row.user_status || 'active',
    avatarUrl: row.avatar_url || null,
    mensajesHoy: row.mensajes_hoy || 0,
    ultimaFechaChat: row.ultima_fecha_chat || null
  };
}

function parsePagination(req) {
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const offset = (page - 1) * limit;
  return { limit, page, offset };
}

router.get('/statistics', requireAdmin, async (_req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const [translations, languages, fileTypes, users] = await Promise.all([
      pool.query(`SELECT COUNT(*)::INT AS total FROM translation_history WHERE status = 'success'`),
      pool.query(`
        SELECT target_language AS language, COUNT(*)::INT AS total
        FROM translation_history
        WHERE target_language IS NOT NULL AND target_language <> ''
        GROUP BY target_language
        ORDER BY total DESC
        LIMIT 10
      `),
      pool.query(`
        SELECT LOWER(file_type) AS file_type, COUNT(*)::INT AS total
        FROM translation_history
        WHERE file_type IS NOT NULL AND file_type <> ''
        GROUP BY LOWER(file_type)
        ORDER BY total DESC
      `),
      pool.query(`SELECT COUNT(*)::INT AS total FROM users WHERE COALESCE(user_status, 'active') = 'active'`)
    ]);

    return res.json({
      totalTranslations: translations.rows[0]?.total || 0,
      activeUsers: users.rows[0]?.total || 0,
      mostUsedLanguages: languages.rows,
      filesByType: fileTypes.rows
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al cargar estadísticas.', detail: error.message });
  }
});

router.get('/usage-by-language', requireAdmin, async (_req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const result = await pool.query(`
      SELECT target_language AS language, COUNT(*)::INT AS total
      FROM translation_history
      WHERE target_language IS NOT NULL AND target_language <> ''
      GROUP BY target_language
      ORDER BY total DESC
      LIMIT 10
    `);
    return res.json({ items: result.rows });
  } catch (error) {
    return res.status(500).json({ error: 'Error al cargar uso por idioma.', detail: error.message });
  }
});

router.get('/file-types', requireAdmin, async (_req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const result = await pool.query(`
      SELECT LOWER(file_type) AS fileType, COUNT(*)::INT AS total
      FROM translation_history
      WHERE file_type IS NOT NULL AND file_type <> ''
      GROUP BY LOWER(file_type)
      ORDER BY total DESC
    `);
    return res.json({ items: result.rows });
  } catch (error) {
    return res.status(500).json({ error: 'Error al cargar tipos de archivo.', detail: error.message });
  }
});

router.get('/learning-metrics', requireAdmin, async (_req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const [translations, feedbacks] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::INT AS total,
          COUNT(*) FILTER (WHERE status = 'success')::INT AS successful,
          COUNT(*) FILTER (WHERE status = 'failed')::INT AS failed
        FROM translation_history
      `),
      pool.query(`
        SELECT
          (SELECT COUNT(*)::INT FROM tamon_feedback) AS userFeedback,
          (SELECT COUNT(*)::INT FROM user_feedback) AS correctionSuggestions
      `).catch(() => ({ rows: [{ userfeedback: 0, correctionsuggestions: 0 }] }))
    ]);

    const row = translations.rows[0] || { total: 0, successful: 0, failed: 0 };
    const feedbackRow = feedbacks.rows[0] || {};
    return res.json({
      totalTranslations: row.total,
      successfulTranslations: row.successful,
      failedTranslations: row.failed,
      learningProgressPercent: row.total > 0 ? Math.round((row.successful / row.total) * 100) : 0,
      userFeedback: Number(feedbackRow.userfeedback || feedbackRow.userFeedback || 0),
      correctionSuggestions: Number(feedbackRow.correctionsuggestions || feedbackRow.correctionSuggestions || 0)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al cargar métricas de aprendizaje.', detail: error.message });
  }
});

router.get('/users', requireAdmin, async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const { page, limit, offset } = parsePagination(req);
    const plan = req.query.plan ? normalizePlan(req.query.plan) : null;
    const role = req.query.role ? String(req.query.role).toLowerCase() : null;
    const status = req.query.status ? String(req.query.status).toLowerCase() : null;
    const search = String(req.query.search || '').trim().toLowerCase();

    const filters = [];
    const params = [];
    if (plan) {
      params.push(plan);
      filters.push(`(CASE WHEN users.plan IN ('chill','gratis') THEN 'free' WHEN users.plan IN ('pro','vip') THEN 'pro_plus' ELSE users.plan END) = $${params.length}`);
    }
    if (role) {
      params.push(role);
      filters.push(`LOWER(users.role) = $${params.length}`);
    }
    if (status) {
      params.push(status);
      filters.push(`LOWER(COALESCE(users.user_status, 'active')) = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      filters.push(`(LOWER(users.nombre) LIKE $${params.length} OR LOWER(users.email) LIKE $${params.length})`);
    }

    const whereClause = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const totalResult = await pool.query(`SELECT COUNT(*)::INT AS total FROM users ${whereClause}`, params);

    params.push(limit);
    params.push(offset);
    const usersResult = await pool.query(
      `SELECT id, nombre, email, plan, role, user_status, avatar_url, mensajes_hoy, ultima_fecha_chat
       FROM users
       ${whereClause}
       ORDER BY id DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    return res.json({
      page,
      limit,
      total: totalResult.rows[0]?.total || 0,
      items: usersResult.rows.map(normalizeUserRow)
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al listar usuarios.', detail: error.message });
  }
});

router.get('/users/:id', requireAdmin, async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'ID de usuario inválido.' });

    const [userResult, historyResult] = await Promise.all([
      pool.query(
        `SELECT id, nombre, email, plan, role, user_status, avatar_url, mensajes_hoy, ultima_fecha_chat
         FROM users WHERE id = $1`,
        [userId]
      ),
      pool.query(
        `SELECT id, original_file_name, file_type, source_language, target_language, status, created_at
         FROM translation_history
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [userId]
      )
    ]);

    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    return res.json({
      user: normalizeUserRow(user),
      history: historyResult.rows
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al consultar usuario.', detail: error.message });
  }
});

router.put('/users/:id', requireAdmin, async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId)) return res.status(400).json({ error: 'ID de usuario inválido.' });

    const nextPlan = req.body.plan ? normalizePlan(req.body.plan) : null;
    const nextStatus = req.body.status ? String(req.body.status).toLowerCase() : null;
    const nextRole = req.body.role ? String(req.body.role).toLowerCase() : null;

    const updates = [];
    const params = [];

    if (nextPlan) {
      params.push(nextPlan);
      updates.push(`plan = $${params.length}`);
    }
    if (nextStatus) {
      params.push(nextStatus);
      updates.push(`user_status = $${params.length}`);
    }
    if (nextRole) {
      params.push(nextRole);
      updates.push(`role = $${params.length}`);
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No se enviaron cambios válidos.' });
    }

    params.push(userId);
    const result = await pool.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${params.length}
       RETURNING id, nombre, email, plan, role, user_status, avatar_url, mensajes_hoy, ultima_fecha_chat`,
      params
    );

    if (!result.rows.length) return res.status(404).json({ error: 'Usuario no encontrado.' });
    return res.json({ message: 'Usuario actualizado.', user: normalizeUserRow(result.rows[0]) });
  } catch (error) {
    return res.status(500).json({ error: 'Error al actualizar usuario.', detail: error.message });
  }
});

// Subir nuevos ejemplos/correcciones
router.post('/training-data', requireAdmin, async (req, res) => {
  try {
    const { type, data } = req.body;
    let result;
    switch (type) {
      case 'correction':
        result = await CorrectionSuggestion.create(data);
        break;
      case 'rule':
        result = await DomainRule.create(data);
        break;
      case 'glossary':
        result = await GlossaryEntry.create(data);
        break;
      default:
        return res.status(400).json({ error: 'Tipo no soportado' });
    }
    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Listar sugerencias de la IA para revisión
router.get('/suggestions', requireAdmin, async (_req, res) => {
  try {
    const suggestions = await CorrectionSuggestion.find({ status: 'pending' });
    res.json(suggestions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aprobar sugerencia
router.post('/suggestions/:id/approve', requireAdmin, async (req, res) => {
  try {
    const suggestion = await CorrectionSuggestion.findByIdAndUpdate(
      req.params.id,
      { status: 'approved' },
      { new: true }
    );
    res.json(suggestion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Rechazar sugerencia
router.post('/suggestions/:id/reject', requireAdmin, async (req, res) => {
  try {
    const suggestion = await CorrectionSuggestion.findByIdAndUpdate(
      req.params.id,
      { status: 'rejected' },
      { new: true }
    );
    res.json(suggestion);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Modificar una regla existente
router.put('/rules/:id', requireAdmin, async (req, res) => {
  try {
    const rule = await DomainRule.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(rule);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Agregar término al glosario
router.post('/glossary', requireAdmin, async (req, res) => {
  try {
    const entry = await GlossaryEntry.create(req.body);
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
