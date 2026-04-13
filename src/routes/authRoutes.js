const express = require('express');
const router = express.Router();
const User = require('../models/User');
const nodemailer = require('nodemailer');

// Configuramos el enviador de correos (Nodemailer)
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER || 'tu_correo@gmail.com', 
    pass: process.env.EMAIL_PASS || 'tu_contraseña_de_aplicacion'
  }
});

router.post('/register', async (req, res) => {
  try {
    const { nombre, correo, password } = req.body;

    if (!nombre || !correo || !password) {
      return res.status(400).json({ error: 'Completa todos los campos.' });
    }

    let usuarioExistente = await User.findOne({ correo: correo.toLowerCase() });
    if (usuarioExistente) {
      return res.status(400).json({ error: 'Este correo ya está registrado.' });
    }

    const nuevoUsuario = new User({ nombre, correo, password });
    await nuevoUsuario.save();

    // Intentamos enviar el correo de bienvenida en segundo plano
    try {
      await transporter.sendMail({
        from: '"Tamon Translator" <no-reply@tamon.com>',
        to: correo,
        subject: '¡Bienvenido a Tamon Translator! ✨',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
            <h2 style="color: #7928ca;">¡Hola ${nombre}!</h2>
            <p>Tu cuenta en Tamon ha sido creada con éxito.</p>
            <p>Prepárate para traducir y aplicar aprendizaje hiperautomatizado a tus documentos.</p>
            <br/>
            <p>Saludos,<br/><strong>El equipo de Tamon IA</strong></p>
          </div>
        `
      });
    } catch (emailError) {
      console.log('Aviso: Usuario registrado, pero falló el envío de correo (Falta configurar credenciales).');
    }

    res.status(201).json({ 
      mensaje: '¡Usuario registrado con éxito!',
      usuario: { nombre: nuevoUsuario.nombre, correo: nuevoUsuario.correo }
    });

  } catch (error) {
    res.status(500).json({ error: 'Error interno del servidor.' });
  }
});
// Ruta para Iniciar Sesión (POST /api/auth/login)
router.post('/login', async (req, res) => {
  try {
    const { correo, password } = req.body;

    if (!correo || !password) {
      return res.status(400).json({ error: 'Por favor, ingresa correo y contraseña.' });
    }

    // 1. Buscamos al usuario por su correo
    const usuario = await User.findOne({ correo: correo.toLowerCase() });
    if (!usuario) {
      return res.status(400).json({ error: 'Correo o contraseña incorrectos.' });
    }

    // 2. Comparamos la contraseña ingresada con la guardada en Mongoose
    const passwordValido = await usuario.compararPassword(password);
    if (!passwordValido) {
      return res.status(400).json({ error: 'Correo o contraseña incorrectos.' });
    }

    // 3. Si todo está bien, le damos la bienvenida
    res.status(200).json({
      mensaje: 'Inicio de sesión exitoso',
      usuario: {
        id: usuario._id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        plan: usuario.plan
      }
    });

  } catch (error) {
    console.error('Error en el login:', error);
    res.status(500).json({ error: 'Error interno del servidor al iniciar sesión.' });
  }
});
module.exports = router;