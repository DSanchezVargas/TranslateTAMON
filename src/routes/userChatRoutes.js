const express = require('express');
const router = express.Router();
const { OpenAI } = require('openai'); // Importamos OpenAI

// Inicializamos la conexión usando la llave de tu archivo .env
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Chat normal para usuario (user o pro_plus)
const { extractTextFromFile } = require('../services/fileTextExtractor');

router.post('/chat', async (req, res) => {
  try {
    const { message, fileUrl, userName } = req.body;
    let extractedText = '';
    
    if (fileUrl) {
      const filePath = require('path').join(__dirname, '../../uploads', fileUrl.split('/').pop());
      try {
        extractedText = await extractTextFromFile(filePath);
      } catch (e) {
        extractedText = '';
      }
    }

    // 1. Llamamos al "Cerebro" de Tamon (OpenAI)
    const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
            { 
                role: "system", 
                content: `Eres Tamon, un asistente de Inteligencia Artificial amigable, traductor experto y tutor de idiomas hiperautomatizado. Estás hablando con ${userName || 'un Usuario'}. Tu objetivo es ayudar a traducir textos y enseñar idiomas (explicar gramática, contexto y vocabulario). No sigas un guion fijo. Sé natural, conversacional, empático y directo.` 
            },
            { 
                role: "user", 
                // Si el usuario adjuntó un archivo, le pasamos el texto a Tamon para que tenga contexto
                content: extractedText ? `[Contexto del archivo adjunto]: ${extractedText}\n\nMi mensaje: ${message}` : message 
            }
        ],
        max_tokens: 500,
        temperature: 0.7
    });

    const tamonResponse = completion.choices[0].message.content;

    // 2. Guardamos en el historial (Tu lógica original intacta)
    const ChatMessage = require('../models/ChatMessage');
    await ChatMessage.create({
      sender: 'user',
      userId: req.user ? req.user._id : null,
      message,
      fileUrl,
      extractedText,
      chatType: 'user'
    });
    
    // 3. Devolvemos la respuesta real de la IA
    res.json({ response: tamonResponse, extractedText });
    
  } catch (err) {
    console.error("Error en OpenAI:", err);
    res.status(500).json({ error: 'Mis circuitos están sobrecargados. Intenta en un momento.' });
  }
});

module.exports = router;