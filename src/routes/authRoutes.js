const express = require('express');
const router = express.Router();
const User = require('../models/User');
const nodemailer = require('nodemailer');

// Configuramos el enviador de correos
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, 
    pass: process.env.EMAIL_PASS
  }
});

// --- RUTA DE REGISTRO ---
router.post('/register', async (req, res) => {
  try {
    const { nombre, correo, password } = req.body;

    if (!nombre || !correo || !password) {
      return res.status(400).json({ error: 'Faltan datos para el registro.' });
    }

    // Verificar si ya existe antes de intentar guardar
    let userExists = await User.findOne({ correo: correo.toLowerCase() });
    if (userExists) {
      // Es vital retornar aquí para que el código no siga ejecutándose
      return res.status(400).json({ error: 'Este correo ya tiene una cuenta activa.' });
    }

    const nuevoUsuario = new User({ nombre, correo, password });
    await nuevoUsuario.save();

    // Intento de envío de correo (no bloquea el registro si falla)
    try {
      if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
        await transporter.sendMail({
          from: '"Tamon IA" <no-reply@tamon.com>',
          to: correo,
          subject: '¡Bienvenido a Tamon! ✨',
          text: `Hola ${nombre}, tu cuenta ha sido creada.`
        });
      }
    } catch (mailErr) {
      console.error('Error enviando correo:', mailErr);
    }

    return res.status(201).json({ 
      mensaje: '¡Registro exitoso!',
      usuario: { id: nuevoUsuario._id, nombre: nuevoUsuario.nombre, correo: nuevoUsuario.correo } 
    });

  } catch (error) {
    console.error('ERROR CRÍTICO EN REGISTRO:', error);
    return res.status(500).json({ error: 'Error interno al crear la cuenta.' });
  }
});

// --- RUTA DE LOGIN MODERNO (JWT y QR opcional) ---
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

router.post('/login', async (req, res) => {
  try {
    const { correo, username, password, qr } = req.body;
    let usuario;
    if (qr) {
      // Login por QR: el QR contiene el correo y un token temporal
      let decoded;
      try {
        decoded = jwt.verify(qr, JWT_SECRET);
      } catch (e) {
        return res.status(400).json({ error: 'QR inválido o expirado.' });
      }
      usuario = await User.findOne({ correo: decoded.correo, role: 'admin' });
      if (!usuario) {
        return res.status(400).json({ error: 'Solo los administradores pueden iniciar sesión con QR.' });
      }
    } else {
      if (correo) {
        usuario = await User.findOne({ correo: correo.toLowerCase() });
      } else if (username) {
        usuario = await User.findOne({ username: username.trim().toLowerCase() });
      }
      if (!usuario) {
        return res.status(400).json({ error: 'Usuario no encontrado.' });
      }
      const esValido = await usuario.compararPassword(password);
      if (!esValido) {
        return res.status(400).json({ error: 'Contraseña incorrecta.' });
      }
    }
    // Generar JWT para sesión
    const token = jwt.sign({ id: usuario._id, role: usuario.role, nombre: usuario.nombre, username: usuario.username }, JWT_SECRET, { expiresIn: '2h' });
    res.status(200).json({
      mensaje: 'Login exitoso',
      usuario: { id: usuario._id, nombre: usuario.nombre, username: usuario.username, correo: usuario.correo, role: usuario.role },
      token
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

// Endpoint para generar QR de login (solo admin)
router.post('/admin/generate-login-qr', async (req, res) => {
  try {
    const { correo } = req.body;
    const usuario = await User.findOne({ correo: correo.toLowerCase(), role: 'admin' });
    if (!usuario) {
      return res.status(400).json({ error: 'Solo admins pueden usar QR.' });
    }
    const qrPayload = jwt.sign({ correo: usuario.correo }, JWT_SECRET, { expiresIn: '5m' });
    const qrImage = await QRCode.toDataURL(qrPayload);
    res.json({ qrImage });
  } catch (error) {
    res.status(500).json({ error: 'No se pudo generar el QR.' });
  }
});

// ESTA ES LA LÍNEA QUE FALTABA Y POR LA QUE CRASHEABA:
module.exports = router;