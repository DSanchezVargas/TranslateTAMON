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
const smtpUser = (process.env.SMTP_USER || process.env.EMAIL_USER || '').trim();
const smtpPass = (process.env.SMTP_PASS || process.env.EMAIL_PASS || '').trim();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT || 465),
  secure: true,
  auth: smtpUser && smtpPass
    ? { user: smtpUser, pass: smtpPass }
    : undefined
});

// --- HELPER PARA DISEÑO PREMIUM DE CORREOS DE TAMON ---
function getTamonEmailHtml(title, contentHtml) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
    </head>
    <body style="margin: 0; padding: 0; background-color: #0d0c15; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff; -webkit-font-smoothing: antialiased;">
      <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #0d0c15; padding: 40px 10px;">
        <tr>
          <td align="center">
            <!-- Contenedor Principal (Estilo Glassmorphism Oscuro) -->
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 500px; background-color: #161421; border: 1px solid #2a2640; border-top: 4px solid #9b30ff; border-radius: 12px; box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5); overflow: hidden;">
              <!-- Header / Logo -->
              <tr>
                <td align="center" style="padding: 30px 20px 20px 20px;">
                  <span style="font-size: 28px; font-weight: 800; letter-spacing: 2px; color: #9b30ff; text-decoration: none;">
                    TAMON <span style="color: #ffffff;">IA</span>
                  </span>
                </td>
              </tr>
              <!-- Contenido -->
              <tr>
                <td style="padding: 20px 30px 40px 30px; line-height: 1.6; font-size: 15px; color: #d1cfe2;">
                  ${contentHtml}
                </td>
              </tr>
              <!-- Footer -->
              <tr>
                <td align="center" style="padding: 20px 30px; background-color: #0f0e1a; border-top: 1px solid #232135; font-size: 12px; color: #625f80;">
                  Este es un correo automático enviado por Tamon IA. Por favor, no respondas a este mensaje.<br>
                  © ${new Date().getFullYear()} Tamon Corporation. Todos los derechos reservados.
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
  `;
}

// --- RUTA DE REGISTRO CON OTP ---
router.post('/register', async (req, res) => {
  try {
    const { nombre, correo, password } = req.body;

    if (!nombre || !correo || !password) {
      return res.status(400).json({ error: 'Faltan datos para el registro.' });
    }

    const userExists = await pool.query('SELECT * FROM users WHERE email = $1', [correo.toLowerCase()]);
    let nuevoUsuario;
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // saltRounds=8 es ~4x más rápido que 10 y sigue siendo criptográficamente seguro
    const SALT_ROUNDS = 8;

    if (userExists.rows.length > 0) {
      const existingUser = userExists.rows[0];
      if (existingUser.user_status === 'active') {
        return res.status(400).json({ error: 'Este correo ya tiene una cuenta activa.' });
      } else {
        // Si la cuenta existe pero está 'pending', regeneramos los datos y el código
        const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
        const updateResult = await pool.query(
          `UPDATE users 
           SET nombre = $1, password = $2, verification_code = $3, verification_code_expires = $4 
           WHERE email = $5 RETURNING id, nombre, email, plan, role, user_status`,
          [nombre, hashedPassword, code, expires, correo.toLowerCase()]
        );
        nuevoUsuario = updateResult.rows[0];
      }
    } else {
      const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
      const insertResult = await pool.query(
        `INSERT INTO users (nombre, email, password, plan, role, user_status, verification_code, verification_code_expires) 
         VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7) RETURNING id, nombre, email, plan, role, user_status`,
        [nombre, correo.toLowerCase(), hashedPassword, 'free', 'user', code, expires]
      );
      nuevoUsuario = insertResult.rows[0];
    }

    console.info(`=== CÓDIGO OTP PARA REGISTRO DE ${correo} ES: ${code} ===`);

    // ⚡ Responder INMEDIATAMENTE al usuario (no esperar al email)
    res.status(201).json({ 
      mensaje: 'Código enviado a tu correo.',
      requiereVerificacion: true,
      correo: nuevoUsuario.email
    });

    // 📧 Enviar email en SEGUNDO PLANO (fire-and-forget, no bloquea)
    if (smtpUser && smtpPass) {
      transporter.sendMail({
        from: `"Tamon IA" <${smtpUser}>`,
        to: correo,
        subject: 'Verifica tu cuenta de Tamon ✨',
        html: getTamonEmailHtml('Verifica tu cuenta', `
          <h2 style="color: #ffffff; margin-top: 0; font-size: 22px; font-weight: 700; text-align: center;">¡Hola, ${nombre}! 👋</h2>
          <p style="text-align: center; margin-bottom: 25px;">
            Gracias por unirte a Tamon IA. Para activar tu cuenta y comenzar a traducir tus archivos de forma inteligente, usa el siguiente código de verificación de 6 dígitos:
          </p>
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0;">
            <tr>
              <td align="center">
                <div style="background-color: #1f1d33; border: 1px solid #7928ca; border-radius: 8px; padding: 15px 30px; display: inline-block;">
                  <span style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: bold; color: #9b30ff; letter-spacing: 8px; line-height: 1;">${code}</span>
                </div>
              </td>
            </tr>
          </table>
          <p style="text-align: center; font-size: 13px; color: #a29fb8; margin-top: 25px;">
            Este código es válido por <strong>15 minutos</strong>. Si no solicitaste este registro, puedes ignorar este mensaje con total seguridad.
          </p>
        `)
      }).catch(mailErr => {
        console.error('Error enviando correo de registro (background):', mailErr.message);
      });
    }

  } catch (error) {
    console.error('ERROR CRÍTICO EN REGISTRO SQL:', error);
    // Solo responder si no se ha enviado ya la respuesta
    if (!res.headersSent) {
      return res.status(500).json({ 
        error: 'Error interno al crear la cuenta.',
        details: error.message
      });
    }
  }
});

// --- RUTA DE VERIFICACIÓN DE CÓDIGO (OTP) ---
router.post('/verify-code', async (req, res) => {
  try {
    const { correo, codigo } = req.body;

    if (!correo || !codigo) {
      return res.status(400).json({ error: 'Faltan datos para la verificación.' });
    }

    const resDB = await pool.query("SELECT * FROM users WHERE email = $1", [correo.toLowerCase()]);
    const usuario = resDB.rows[0];

    if (!usuario) {
      return res.status(400).json({ error: 'Usuario no encontrado.' });
    }

    if (usuario.user_status === 'active') {
      // Si ya está activo, generamos el inicio de sesión automático igualmente por seguridad
      const token = jwt.sign({ id: usuario.id, role: usuario.role, nombre: usuario.nombre }, JWT_SECRET, { expiresIn: '2h' });
      return res.status(200).json({
        mensaje: 'Esta cuenta ya está activa.',
        usuario: { id: usuario.id, nombre: usuario.nombre, correo: usuario.email, role: usuario.role, plan: usuario.plan },
        token
      });
    }

    if (usuario.verification_code !== codigo.trim()) {
      return res.status(400).json({ error: 'El código de verificación es incorrecto.' });
    }

    if (new Date(usuario.verification_code_expires) < new Date()) {
      return res.status(400).json({ error: 'El código ha expirado. Por favor, solicita uno nuevo.' });
    }

    // Activar el usuario y limpiar el código de verificación
    const updateResult = await pool.query(
      `UPDATE users 
       SET user_status = 'active', verification_code = NULL, verification_code_expires = NULL 
       WHERE id = $1 RETURNING id, nombre, email, plan, role`,
      [usuario.id]
    );
    const usuarioActivo = updateResult.rows[0];

    const token = jwt.sign({ id: usuarioActivo.id, role: usuarioActivo.role, nombre: usuarioActivo.nombre }, JWT_SECRET, { expiresIn: '2h' });

    return res.status(200).json({
      mensaje: '¡Cuenta verificada con éxito!',
      usuario: { id: usuarioActivo.id, nombre: usuarioActivo.nombre, correo: usuarioActivo.email, role: usuarioActivo.role, plan: usuarioActivo.plan },
      token
    });

  } catch (error) {
    console.error("Error en verificación de código:", error);
    return res.status(500).json({ error: 'Error al verificar el código.' });
  }
});

// --- RUTA PARA RE-ENVIAR CÓDIGO ---
router.post('/resend-code', async (req, res) => {
  try {
    const { correo } = req.body;
    if (!correo) {
      return res.status(400).json({ error: 'Falta el correo.' });
    }

    const resDB = await pool.query("SELECT * FROM users WHERE email = $1", [correo.toLowerCase()]);
    const usuario = resDB.rows[0];

    if (!usuario) {
      return res.status(400).json({ error: 'Usuario no encontrado.' });
    }

    if (usuario.user_status === 'active') {
      return res.status(400).json({ error: 'Esta cuenta ya está activa.' });
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    await pool.query(
      "UPDATE users SET verification_code = $1, verification_code_expires = $2 WHERE id = $3",
      [code, expires, usuario.id]
    );

    console.info(`=== CÓDIGO OTP RE-ENVIADO PARA ${correo} ES: ${code} ===`);

    // ⚡ Responder INMEDIATAMENTE
    res.status(200).json({ mensaje: 'Nuevo código enviado con éxito.' });

    // 📧 Email en segundo plano
    if (smtpUser && smtpPass) {
      transporter.sendMail({
        from: `"Tamon IA" <${smtpUser}>`,
        to: correo,
        subject: 'Tu nuevo código de verificación - Tamon ✨',
        html: getTamonEmailHtml('Verifica tu cuenta', `
          <h2 style="color: #ffffff; margin-top: 0; font-size: 22px; font-weight: 700; text-align: center;">¡Hola, ${usuario.nombre}! 👋</h2>
          <p style="text-align: center; margin-bottom: 25px;">
            Aquí tienes tu nuevo código de verificación de 6 dígitos para activar tu cuenta de Tamon:
          </p>
          <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0;">
            <tr>
              <td align="center">
                <div style="background-color: #1f1d33; border: 1px solid #7928ca; border-radius: 8px; padding: 15px 30px; display: inline-block;">
                  <span style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: bold; color: #9b30ff; letter-spacing: 8px; line-height: 1;">${code}</span>
                </div>
              </td>
            </tr>
          </table>
          <p style="text-align: center; font-size: 13px; color: #a29fb8; margin-top: 25px;">
            Este código es válido por <strong>15 minutos</strong>.
          </p>
        `)
      }).catch(mailErr => {
        console.error('Error enviando correo de re-envío (background):', mailErr.message);
      });
    }

  } catch (error) {
    console.error("Error en re-envío de código:", error);
    if (!res.headersSent) {
      return res.status(500).json({ error: 'Error al re-enviar el código.' });
    }
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
    
    // Si la cuenta está 'pending', generamos un código nuevo y retornamos error informando el estado
    if (usuario.user_status === 'pending') {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      const expires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

      await pool.query(
        "UPDATE users SET verification_code = $1, verification_code_expires = $2 WHERE id = $3",
        [code, expires, usuario.id]
      );

      console.info(`=== CÓDIGO OTP GENERADO POR LOGIN PENDIENTE PARA ${usuario.email} ES: ${code} ===`);

      try {
        if (smtpUser && smtpPass) {
          await transporter.sendMail({
            from: `"Tamon IA" <${smtpUser}>`,
            to: usuario.email,
            subject: 'Verifica tu cuenta de Tamon ✨',
            html: getTamonEmailHtml('Verifica tu cuenta', `
              <h2 style="color: #ffffff; margin-top: 0; font-size: 22px; font-weight: 700; text-align: center;">¡Hola, ${usuario.nombre}! 👋</h2>
              <p style="text-align: center; margin-bottom: 25px;">
                Tu cuenta aún no está activa. Para completarla y comenzar a traducir tus archivos de forma inteligente, usa el siguiente código de verificación de 6 dígitos:
              </p>
              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0;">
                <tr>
                  <td align="center">
                    <div style="background-color: #1f1d33; border: 1px solid #7928ca; border-radius: 8px; padding: 15px 30px; display: inline-block;">
                      <span style="font-family: 'Courier New', Courier, monospace; font-size: 32px; font-weight: bold; color: #9b30ff; letter-spacing: 8px; line-height: 1;">${code}</span>
                    </div>
                  </td>
                </tr>
              </table>
              <p style="text-align: center; font-size: 13px; color: #a29fb8; margin-top: 25px;">
                Este código es válido por <strong>15 minutos</strong>.
              </p>
            `)
          });
        }
      } catch (mailErr) {
        console.error('Error enviando correo de verificación en login:', mailErr);
      }

      return res.status(400).json({ 
        error: 'Debes verificar tu cuenta primero. Te hemos enviado un nuevo código a tu correo.',
        requiereVerificacion: true,
        correo: usuario.email
      });
    }

    const token = jwt.sign({ id: usuario.id, role: usuario.role, nombre: usuario.nombre }, JWT_SECRET, { expiresIn: '2h' });
    
    res.status(200).json({
      mensaje: 'Login exitoso',
      usuario: { id: usuario.id, nombre: usuario.nombre, correo: usuario.email, role: usuario.role, plan: usuario.plan },
      token
    });
  } catch (error) {
    console.error("Error en login:", error);
    res.status(500).json({ 
      error: 'Error al iniciar sesión.',
      details: error.message,
      stack: error.stack
    });
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

// --- RUTA PARA FILA VIP (TAMON PRO+) CON DISEÑO PREMIUM ---
router.post('/join-vip', async (req, res) => {
  try {
    const { correo, nombre } = req.body;

    if (!correo) {
      return res.status(400).json({ error: 'No se encontró un correo válido.' });
    }

    if (smtpUser && smtpPass) {
      await transporter.sendMail({
        from: `"Tamon IA VIP" <${smtpUser}>`,
        to: correo,
        subject: '¡Estás en la lista VIP de Tamon Pro+! ✨',
        html: getTamonEmailHtml('Fila VIP Tamon Pro+', `
          <h2 style="color: #ffffff; margin-top: 0; font-size: 22px; font-weight: 700; text-align: center;">¡Bienvenido al futuro de la traducción! 🚀</h2>
          <p style="text-align: center; margin-bottom: 20px;">
            Hola, <strong>${nombre || 'viajero del futuro'}</strong>. Hemos reservado con éxito tu acceso a la fila VIP para la fase Beta privada de <strong>Tamon Pro+</strong>.
          </p>
          
          <p style="text-align: center; margin-bottom: 25px; color: #a7e9f7; font-weight: 600; font-size: 16px;">
            ¡Ya eres un miembro VIP! 👑
          </p>

          <div style="background-color: #12101a; border-left: 4px solid #7928ca; padding: 15px; border-radius: 4px; margin-bottom: 25px;">
            <p style="margin: 0; font-size: 14px; color: #d1cfe2; line-height: 1.5;">
              Nuestra pasarela de pagos oficial está en proceso de integración. En cuanto esté lista, te avisaremos de inmediato a este correo para que seas uno de los primeros en probar las capacidades premium de Tamon Pro+ con un beneficio exclusivo.
            </p>
          </div>

          <p style="text-align: center; font-size: 14px; margin-bottom: 0; color: #d1cfe2;">
            Prepárate para experimentar traducción instantánea sin límites, memorias de traducción dedicadas y soporte prioritario.
          </p>
        `)
      });
    }
    
    return res.status(200).json({
      message: (smtpUser && smtpPass)
        ? 'Correo VIP enviado con éxito'
        : 'Solicitud VIP registrada (SMTP no configurado)'
    });

  } catch (error) {
    console.error('Error enviando correo VIP:', error);
    return res.status(500).json({ error: 'Hubo un error al intentar enviar el correo. Verifica tu contraseña de aplicación de Gmail.' });
  }
});

module.exports = router;