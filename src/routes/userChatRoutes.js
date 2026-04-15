const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// Inicializamos Gemini con tu llave del .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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

    // 1. Configuramos el modelo de Gemini y le damos la "personalidad" de Tamon
    const model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        systemInstruction: `Eres Tamon, un asistente de Inteligencia Artificial amigable, traductor experto y tutor de idiomas hiperautomatizado. Estás hablando con ${userName || 'un Usuario'}. Tu objetivo es ayudar a traducir textos y enseñar idiomas (explicar gramática, contexto y vocabulario). No sigas un guion fijo. Sé natural, conversacional, empático y directo.`
    });

    // 2. Preparamos el texto a enviar (juntando el archivo y el mensaje)
    const prompt = extractedText 
        ? `[Contexto del archivo adjunto]: ${extractedText}\n\nMi mensaje: ${message}` 
        : message;

    // 3. Llamamos a Gemini
    const result = await model.generateContent(prompt);
    const tamonResponse = result.response.text();

    // 4. Guardamos en tu base de datos (Tu historial)
    const ChatMessage = require('../models/ChatMessage');
    await ChatMessage.create({
      sender: 'user',
      userId: req.user ? req.user._id : null,
      message,
      fileUrl,
      extractedText,
      chatType: 'user'
    });
    
    // 5. Respondemos a tu página web
    res.json({ response: tamonResponse, extractedText });
    
  } catch (err) {
    console.error("Error en Gemini:", err);
    res.status(500).json({ error: 'Mis circuitos están sobrecargados. Intenta en un momento.' });
  }
});

module.exports = router;