const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt'); 
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const nodemailer = require('nodemailer');
const { pool } = require('../config/db'); 

const JWT_SECRET = process.env.JWT_SECRET || 'supersecret';

// --- LA MAGIA PARA RENDER: Obligar al servidor a usar IPv4 ---
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
// -------------------------------------------------------------

// Configuramos el enviador de correos con tus credenciales
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true, 
  auth: {
    user: 'noblesserai20@gmail.com', 
    pass: 'orpxqlpvffgjossz' 
  }
});

// --- RUTA DE REGISTRO ---
router.post('/register', async (req, res) => {
  try {
    const { nombre, correo, password } = req.body;

    if (!nombre || !correo || !password) {
      return res.status(400).json({ error: 'Faltan datos para el registro.' });
    }

    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [correo.toLowerCase()]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ error: 'Este correo ya tiene una cuenta activa.' });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const result = await pool.query(
      `INSERT INTO users (nombre, email, password, plan, role) 
       VALUES ($1, $2, $3, $4, $5) RETURNING id, nombre, email, plan, role`,
      [nombre, correo.toLowerCase(), hashedPassword, 'chill', 'user']
    );
    const nuevoUsuario = result.rows[0];

    try {
      await transporter.sendMail({
        from: '"Tamon IA" <noblesserai20@gmail.com>',
        to: correo,
        subject: '¡Bienvenido a Tamon! ✨',
        text: `Hola ${nombre}, tu cuenta ha sido creada con éxito en Tamon.`
      });
    } catch (mailErr) {
      console.error('Error enviando correo de registro:', mailErr);
    }

    return res.status(201).json({ 
      mensaje: '¡Registro exitoso!',
      usuario: { id: nuevoUsuario.id, nombre: nuevoUsuario.nombre, correo: nuevoUsuario.email, role: nuevoUsuario.role, plan: nuevoUsuario.plan } 
    });

  } catch (error) {
    console.error('ERROR CRÍTICO EN REGISTRO SQL:', error);
    return res.status(500).json({ error: 'Error interno al crear la cuenta.' });
  }
});

// --- RUTA DE LOGIN MODERNO ---
router.post('/login', async (req, res) => {
  try {
    const { correo, password, qr } = req.body;
    let usuario;

    if (qr) {
      let decoded;
      try {
        decoded = jwt.verify(qr, JWT_SECRET);
      } catch (e) {
        return res.status(400).json({ error: 'QR inválido o expirado.' });
      }
      
      const resDB = await pool.query("SELECT * FROM users WHERE email = $1 AND role = 'admin'", [decoded.correo]);
      usuario = resDB.rows[0];
      
      if (!usuario) {
        return res.status(400).json({ error: 'Solo los administradores pueden iniciar sesión con QR.' });
      }
    } 
    else {
      if (!correo) return res.status(400).json({ error: 'Falta el correo.' });
      
      const resDB = await pool.query("SELECT * FROM users WHERE email = $1", [correo.toLowerCase()]);
      usuario = resDB.rows[0];
      
      if (!usuario) {
        return res.status(400).json({ error: 'Usuario no encontrado. Asegúrate de registrarte primero.' });
      }
      
      const esValido = await bcrypt.compare(password, usuario.password);
      if (!esValido) {
        return res.status(400).json({ error: 'Contraseña incorrecta.' });
      }
    }
    
    const token = jwt.sign({ id: usuario.id, role: usuario.role, nombre: usuario.nombre }, JWT_SECRET, { expiresIn: '2h' });
    
    res.status(200).json({
      mensaje: 'Login exitoso',
      usuario: { id: usuario.id, nombre: usuario.nombre, correo: usuario.email, role: usuario.role, plan: usuario.plan },
      token
    });
  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({ error: 'Error al iniciar sesión.' });
  }
});

// --- RUTA QR PARA ADMINS ---
router.post('/admin/generate-login-qr', async (req, res) => {
  try {
    const { correo } = req.body;
    const resDB = await pool.query("SELECT * FROM users WHERE email = $1 AND role = 'admin'", [correo.toLowerCase()]);
    const usuario = resDB.rows[0];
    
    if (!usuario) {
      return res.status(400).json({ error: 'Solo admins pueden usar QR.' });
    }
    const qrPayload = jwt.sign({ correo: usuario.email }, JWT_SECRET, { expiresIn: '5m' });
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