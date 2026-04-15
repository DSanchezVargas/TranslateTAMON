const express = require('express');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// Middleware para autenticar usando JWT
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado.' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido.' });
  }
}

// Endpoint para obtener el perfil del usuario autenticado
router.get('/profile', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('nombre username correo plan role');
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }
    res.json({
      id: user._id,
      nombre: user.nombre,
      username: user.username,
      correo: user.correo,
      plan: user.plan,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al obtener el perfil.' });
  }
});

// Permitir que el usuario configure su username si no tiene uno
router.put('/profile/username', requireAuth, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || username.trim().length < 3) {
      return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 3 caracteres.' });
    }
    // Verifica que no exista otro usuario con ese username
    const existe = await User.findOne({ username: username.trim().toLowerCase() });
    if (existe) {
      return res.status(400).json({ error: 'Ese nombre de usuario ya está en uso.' });
    }
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { username: username.trim().toLowerCase() },
      { new: true }
    ).select('nombre username correo plan role');
    res.json({
      id: user._id,
      nombre: user.nombre,
      username: user.username,
      correo: user.correo,
      plan: user.plan,
      role: user.role
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al actualizar el nombre de usuario.' });
  }
});

module.exports = router;
