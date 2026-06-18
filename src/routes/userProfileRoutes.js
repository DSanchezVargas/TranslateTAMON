const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { pool, isDbReady } = require('../config/db');
const { getPlanDetails, normalizePlan } = require('../utils/planCatalog');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

const AVATAR_DIR = path.join(__dirname, '../../public/uploads/avatars');
if (!fs.existsSync(AVATAR_DIR)) {
  fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

const avatarStorage = multer.diskStorage({
  destination: (_, __, cb) => cb(null, AVATAR_DIR),
  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase() || '.png';
    cb(null, `avatar-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
  }
});

const avatarUpload = multer({
  storage: avatarStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, cb) => {
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/jpg'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Formato de avatar no permitido.'));
    }
    cb(null, true);
  }
});

function getUserIdFromRequest(req) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    return Number(decoded.id);
  }
  return Number(req.user?.id || req.user?._id);
}

async function getDbUser(userId) {
  const result = await pool.query(
    `SELECT id, nombre, email, plan, role, username, avatar_url, user_status, mensajes_hoy, ultima_fecha_chat
     FROM users WHERE id = $1`,
    [userId]
  );
  return result.rows[0];
}

function requireAuth(req, res, next) {
  try {
    const userId = getUserIdFromRequest(req);
    if (!Number.isInteger(userId)) {
      return res.status(401).json({ error: 'Token no proporcionado o sesión inválida.' });
    }
    req.authUserId = userId;
    return next();
  } catch (_error) {
    return res.status(401).json({ error: 'Token inválido.' });
  }
}

router.get('/', requireAuth, async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const user = await getDbUser(req.authUserId);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const normalizedPlan = normalizePlan(user.plan);
    const planInfo = getPlanDetails(normalizedPlan);
    const usedDocs = Number(user.mensajes_hoy || 0);
    const quota = planInfo.dailyDocumentQuota === null
      ? { used: usedDocs, total: null, remaining: null, unlimited: true }
      : {
          used: usedDocs,
          total: planInfo.dailyDocumentQuota,
          remaining: Math.max(planInfo.dailyDocumentQuota - usedDocs, 0),
          unlimited: false
        };

    const historyResult = await pool.query(
      `SELECT id, original_file_name, file_type, source_language, target_language, status, created_at
       FROM translation_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [req.authUserId]
    );

    return res.json({
      id: user.id,
      nombre: user.nombre,
      username: user.username,
      correo: user.email,
      role: user.role,
      status: user.user_status || 'active',
      avatarUrl: user.avatar_url || null,
      plan: normalizedPlan,
      planInfo,
      quota,
      translationHistory: historyResult.rows
    });
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener el perfil.', detail: error.message });
  }
});

router.put('/', requireAuth, async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const nombre = String(req.body.nombre || '').trim();
    const correo = String(req.body.correo || '').trim().toLowerCase();
    if (!nombre || !correo) {
      return res.status(400).json({ error: 'Nombre y correo son obligatorios.' });
    }

    const duplicate = await pool.query('SELECT id FROM users WHERE email = $1 AND id <> $2', [correo, req.authUserId]);
    if (duplicate.rows.length) {
      return res.status(409).json({ error: 'El correo ya está en uso.' });
    }

    const updated = await pool.query(
      `UPDATE users SET nombre = $1, email = $2 WHERE id = $3
       RETURNING id, nombre, email, plan, role, username, avatar_url, user_status`,
      [nombre, correo, req.authUserId]
    );

    return res.json({ message: 'Perfil actualizado.', user: updated.rows[0] });
  } catch (error) {
    return res.status(500).json({ error: 'Error al actualizar perfil.', detail: error.message });
  }
});

router.put('/password', requireAuth, async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Debes enviar contraseña actual y nueva.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 8 caracteres.' });
    }

    const userResult = await pool.query('SELECT id, password FROM users WHERE id = $1', [req.authUserId]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'La contraseña actual es incorrecta.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(newPassword, salt);
    await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashed, req.authUserId]);
    return res.json({ message: 'Contraseña actualizada correctamente.' });
  } catch (error) {
    return res.status(500).json({ error: 'Error al cambiar contraseña.', detail: error.message });
  }
});

router.post('/avatar', requireAuth, avatarUpload.single('avatar'), async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  if (!req.file) return res.status(400).json({ error: 'Debes subir una imagen.' });

  try {
    const avatarUrl = `/uploads/avatars/${req.file.filename}`;
    const previousAvatarResult = await pool.query('SELECT avatar_url FROM users WHERE id = $1', [req.authUserId]);
    await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, req.authUserId]);

    const previousAvatar = previousAvatarResult.rows[0]?.avatar_url;
    if (previousAvatar && previousAvatar.startsWith('/uploads/avatars/')) {
      const previousPath = path.join(__dirname, '../../public', previousAvatar);
      if (fs.existsSync(previousPath)) fs.unlinkSync(previousPath);
    }

    return res.json({ message: 'Avatar actualizado.', avatarUrl });
  } catch (error) {
    return res.status(500).json({ error: 'Error al actualizar avatar.', detail: error.message });
  }
});

router.get('/history', requireAuth, async (req, res) => {
  if (!isDbReady()) return res.status(503).json({ error: 'Base de datos no disponible.' });
  try {
    const history = await pool.query(
      `SELECT id, original_file_name, file_type, source_language, target_language, status, created_at
       FROM translation_history
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 100`,
      [req.authUserId]
    );
    return res.json({ items: history.rows });
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener historial.', detail: error.message });
  }
});

module.exports = router;
