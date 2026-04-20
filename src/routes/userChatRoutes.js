const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { pool } = require('../config/db'); 

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const { extractTextFromFile } = require('../services/fileTextExtractor');

router.post('/chat', async (req, res) => {
  try {
    const { message, fileUrl, userName } = req.body;
    let extractedText = '';
    
    let userIdToSave = null; 
    let mensajesRestantes = 0; 

    if (req.user) {
      // Intentamos convertir el ID a número (Escudo anti-MongoDB)
      const rawId = req.user.id || req.user._id;
      userIdToSave = parseInt(rawId, 10); 
      
      if (!isNaN(userIdToSave)) {
        const userResult = await pool.query('SELECT * FROM users WHERE id = $1', [userIdToSave]);
        const userRecord = userResult.rows[0];
        
        if (userRecord) {
          const ahora = new Date();
          const ultimaFecha = new Date(userRecord.ultima_fecha_chat); 
          
          let mensajesHoy = userRecord.mensajes_hoy || 0;

          if (ahora.getDate() !== ultimaFecha.getDate() || ahora.getMonth() !== ultimaFecha.getMonth() || ahora.getFullYear() !== ultimaFecha.getFullYear()) {
            mensajesHoy = 0;
          }

          const maxMensajes = userRecord.plan === 'pro_plus' || userRecord.role === 'admin' ? 500 : 15;
          mensajesRestantes = maxMensajes - mensajesHoy; 

          if (mensajesRestantes <= 0) {
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Transfer-Encoding', 'chunked');
            res.write("¡Bostezo virtual! 🥱 Mis circuitos necesitan descansar. Entro en modo reposo hasta la medianoche. ¡Hablamos mañana!");
            return res.end();
          }

          mensajesHoy += 1;
          await pool.query(
              'UPDATE users SET mensajes_hoy = $1, ultima_fecha_chat = CURRENT_TIMESTAMP WHERE id = $2',
              [mensajesHoy, userIdToSave]
          );
        }
      } else {
        userIdToSave = null; // Si tiene ID de MongoDB, lo tratamos como invitado para no romper la BD
      }
    }

    if (fileUrl) {
      const filePath = require('path').join(__dirname, '../../uploads', fileUrl.split('/').pop());
      try { extractedText = await extractTextFromFile(filePath); } catch (e) { }
    }

    let instrucciones = `Eres Tamon, un asistente de Inteligencia Artificial amigable, traductor experto y tutor de idiomas hiperautomatizado. Estás hablando con ${userName || 'un Usuario'}. Tu objetivo es ayudar a traducir textos y enseñar idiomas. No sigas un guion fijo. Sé natural, conversacional y empático.`;
    
    if (req.user && typeof mensajesRestantes !== 'undefined' && mensajesRestantes > 0 && mensajesRestantes <= 3) {
        instrucciones += `\n\n[INSTRUCCIÓN DEL SISTEMA]: Este es un aviso interno. Al usuario le quedan exactamente ${mensajesRestantes} mensajes gratuitos en su cuota de hoy. AL FINAL de tu respuesta, añade una nota muy breve y amable informándole esto. Dile que cuando se agoten, entrarás en reposo y la cuota se restaurará automáticamente a la medianoche (00:00, hora local de Perú). Sé casual y no suenes como una máquina automatizada.`;
    }

    const model = genAI.getGenerativeModel({ 
        model: "gemini-3.1-flash-lite-preview", 
        systemInstruction: instrucciones
    });
    
    const prompt = extractedText ? `[Contexto del archivo]: ${extractedText}\n\nMensaje: ${message}` : message;

    const result = await model.generateContentStream(prompt);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    let fullResponse = "";
    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullResponse += chunkText;
      res.write(chunkText); 
    }
    res.end(); 

    if (userIdToSave) {
      try {
          await pool.query(
              `INSERT INTO chat_messages (sender, user_id, message, file_url, extracted_text) 
               VALUES ($1, $2, $3, $4, $5)`,
              ['tamon', userIdToSave, fullResponse, fileUrl, extractedText]
          );
      } catch (e) {
          console.error("Error guardando historial en Postgres:", e);
      }
    }
    
  } catch (err) {
    console.error("ERROR REAL DE LA API:", err.message); 
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error: Mis circuitos están sobrecargados.' });
    } else {
      res.end();
    }
  }
});

// RUTA PARA GUARDAR EL FEEDBACK (👎)
router.post('/feedback', async (req, res) => {
  try {
    const { userId, botMessage, userComment } = req.body;
    
    // Escudo anti-MongoDB
    const safeUserId = parseInt(userId, 10);
    const finalUserId = isNaN(safeUserId) ? null : safeUserId;

    await pool.query(
      `INSERT INTO tamon_feedback (user_id, bot_message, user_comment) VALUES ($1, $2, $3)`,
      [finalUserId, botMessage, userComment]
    );
    
    res.json({ success: true });
  } catch (error) {
    console.error("Error guardando feedback:", error);
    res.status(500).json({ error: 'Error al procesar el comentario' });
  }
});

// --- RUTA PARA OBTENER LA CUOTA EN VIVO ---
router.get('/quota/:id', async (req, res) => {
  try {
    // 1. ESCUDO MEJORADO: Number() convierte todo a NaN si hay letras
    const userId = Number(req.params.id);
    
    // Si no es un número entero válido (ej. tiene letras de MongoDB), lo rebotamos
    if (!Number.isInteger(userId)) {
        return res.status(400).json({ error: 'Sesión obsoleta. Por favor, cierra sesión y vuelve a entrar.' });
    }

    // 2. Consulta SQL segura
    const result = await pool.query('SELECT plan, role, mensajes_hoy, ultima_fecha_chat FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];

    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const ahora = new Date();
    const ultimaFecha = new Date(user.ultima_fecha_chat);
    
    let mensajesUsados = user.mensajes_hoy || 0;
    if (ahora.getDate() !== ultimaFecha.getDate() || ahora.getMonth() !== ultimaFecha.getMonth() || ahora.getFullYear() !== ultimaFecha.getFullYear()) {
      mensajesUsados = 0; 
    }

    const maxMensajes = user.plan === 'pro_plus' || user.role === 'admin' ? 500 : 15;

    res.json({ usados: mensajesUsados, total: maxMensajes });
  } catch (error) {
    console.error("Error cargando cuota:", error);
    res.status(500).json({ error: 'Error al cargar la cuota' });
  }
});

module.exports = router;

