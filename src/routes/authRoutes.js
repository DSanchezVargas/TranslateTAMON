const express = require('express');
const router = express.Router();
const User = require('../models/User');
const nodemailer = require('nodemailer');

// --- LA MAGIA PARA RENDER: Obligar al servidor a usar IPv4 ---
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
// -------------------------------------------------------------

// Configuramos el enviador de correos con tus credenciales
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, // Usa SSL
  auth: {
    user: 'noblesserai20@gmail.com', 
    pass: 'orpxqlpvffgjossz' // Si esta es tu contraseña de aplicación activa, déjala
  }
});

// ... (aquí sigue el resto de tu código de registro, login y vip igualito)

// --- RUTA DE REGISTRO ---
router.post('/register', async (req, res) => {
  try {
    const { nombre, correo, password } = req.body;

    if (!nombre || !correo || !password) {
      return res.status(400).json({ error: 'Faltan datos para el registro.' });
    }

    let userExists = await User.findOne({ correo: correo.toLowerCase() });
    if (userExists) {
      return res.status(400).json({ error: 'Este correo ya tiene una cuenta activa.' });
    }

    const nuevoUsuario = new User({ nombre, correo, password });
    await nuevoUsuario.save();

    // Envío de correo de bienvenida directo (sin el if fantasma)
    try {
      await transporter.sendMail({
        from: '"Tamon IA" <noblesserai20@gmail.com>',
        to: correo,
        subject: '¡Bienvenido a Tamon! ✨',
        text: `Hola ${nombre}, tu cuenta ha sido creada con éxito.`
      });
    } catch (mailErr) {
      console.error('Error enviando correo de registro:', mailErr);
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

// --- RUTA DE LOGIN MODERNO ---
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

router.post('/login', async (req, res) => {
  try {
    const { correo, username, password, qr } = req.body;
    let usuario;
    if (qr) {
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
        return res.status(400).json({ error: 'Usuario no encontrado. Asegúrate de registrarte primero.' });
      }
      const esValido = await usuario.compararPassword(password);
      if (!esValido) {
        return res.status(400).json({ error: 'Contraseña incorrecta.' });
      }
    }
    
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

// --- RUTA PARA FILA VIP (TAMON PRO+) ---
router.post('/join-vip', async (req, res) => {
  try {
    const { correo, nombre } = req.body;

    if (!correo) {
      return res.status(400).json({ error: 'No se encontró un correo válido.' });
    }

    // Usamos el transporter sin validaciones .env que interrumpan el proceso
    await transporter.sendMail({
      from: '"Tamon IA VIP" <noblesserai20@gmail.com>',
      to: correo,
      subject: '¡Estás en la lista VIP de Tamon Pro+! ✨',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #7928ca; border-radius: 10px; background-color: #f8e6f3;">
            <h2 style="color: #7928ca;">¡Hola ${nombre || 'Usuario'}! 🚀</h2>
            <p style="color: #2d1221; font-size: 16px;">Confirmamos que tu espacio ha sido reservado con éxito en nuestra fila VIP.</p>
            <p style="color: #2d1221; font-size: 16px;">La pasarela de pagos oficial está en configuración. Te avisaremos a este correo en cuanto Tamon Pro+ esté habilitado para que seas de los primeros en experimentar el poder total.</p>
            <br>
            <p style="color: #2d1221; font-weight: bold;">Saludos,<br>El equipo de Tamon IA</p>
        </div>
      `
    });
    
    return res.status(200).json({ message: 'Correo VIP enviado con éxito' });

  } catch (error) {
    console.error('Error enviando correo VIP:', error);
    return res.status(500).json({ error: 'Hubo un error al intentar enviar el correo. Verifica tu contraseña de aplicación de Gmail.' });
  }
});

module.exports = router;