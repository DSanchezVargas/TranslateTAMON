const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 1. Inicialización
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const { extractTextFromFile } = require('../services/fileTextExtractor');

router.post('/chat', async (req, res) => {
  try {
    const { message, fileUrl, userName } = req.body;
    let extractedText = '';
    
    // Extracción de texto
    if (fileUrl) {
      const filePath = require('path').join(__dirname, '../../uploads', fileUrl.split('/').pop());
      try {
        extractedText = await extractTextFromFile(filePath);
      } catch (e) {
        console.error("Error al extraer texto del archivo:", e);
      }
    }

// 2. Configuración del modelo (Usando el que SÍ tienes habilitado en AI Studio)
    const model = genAI.getGenerativeModel({ 
        model: "gemini-3.1-flash-lite", // <-- Usa este nombre exacto
        systemInstruction: `Eres Tamon, un asistente de Inteligencia Artificial amigable, traductor experto y tutor de idiomas hiperautomatizado. Estás hablando con ${userName || 'un Usuario'}. Tu objetivo es ayudar a traducir textos y enseñar idiomas (explicar gramática, contexto y vocabulario). No sigas un guion fijo. Sé natural, conversacional, empático y directo.`
    });

    const prompt = extractedText 
        ? `[Contexto del archivo adjunto]: ${extractedText}\n\nMensaje: ${message}` 
        : message;

    // 3. STREAMING: Enviando datos en tiempo real
    const result = await model.generateContentStream(prompt);

    // IMPORTANTE: Headers para Streaming
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    let fullResponse = "";

    for await (const chunk of result.stream) {
      const chunkText = chunk.text();
      fullResponse += chunkText;
      res.write(chunkText); // Enviamos el fragmento al navegador
    }

    res.end(); // Terminamos la conexión correctamente

    // 4. GUARDADO POST-CHAT (En segundo plano para no demorar al usuario)
    const ChatMessage = require('../models/ChatMessage');
    const userIdToSave = req.user ? req.user._id : "000000000000000000000000"; 

    // Guardamos la respuesta de Tamon
    ChatMessage.create({
      sender: 'tamon',
      userId: userIdToSave,
      message: fullResponse,
      fileUrl: fileUrl,
      extractedText: extractedText,
      chatType: 'user'
    }).catch(err => console.error("Error al guardar historial:", err));
    
  } catch (err) {
    console.error("Error en Gemini:", err);
    // Solo intentamos enviar error si no hemos empezado a escribir (res.write)
    if (!res.headersSent) {
      res.status(500).json({ error: 'Error interno de Tamon.' });
    } else {
      res.end(); // Si ya falló a mitad de camino, cerramos la conexión
    }
  }
});

module.exports = router;