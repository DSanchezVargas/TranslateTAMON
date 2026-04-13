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

    let userExists = await User.findOne({ correo: correo.toLowerCase() });
    if (userExists) {
      return res.status(400).json({ error: 'Este correo ya tiene cuenta.' });
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

// --- RUTA DE LOGIN (Para que no de error 404) ---
router.post('/login', async (req, res) => {
  try {
    const { correo, password } = req.body;
    const usuario = await User.findOne({ correo: correo.toLowerCase() });

    if (!usuario) {
      return res.status(400).json({ error: 'Usuario no encontrado.' });
    }

    const esValido = await usuario.compararPassword(password);
    if (!esValido) {
      return res.status(400).json({ error: 'Contraseña incorrecta.' });
    }

    res.status(200).json({
      mensaje: 'Login exitoso',
      usuario: { id: usuario._id, nombre: usuario.nombre, correo: usuario.correo }
    });
  } catch (error) {
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

// ESTA ES LA LÍNEA QUE FALTABA Y POR LA QUE CRASHEABA:
module.exports = router;