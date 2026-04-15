const express = require('express');
const router = express.Router();

// Chat normal para usuario (user o pro_plus)
const { extractTextFromFile } = require('../services/fileTextExtractor');

router.post('/chat', async (req, res) => {
  try {
    const { message, fileUrl } = req.body;
    let extractedText = '';
    if (fileUrl) {
      const filePath = require('path').join(__dirname, '../../uploads', fileUrl.split('/').pop());
      try {
        extractedText = await extractTextFromFile(filePath);
      } catch (e) {
        extractedText = '';
      }
    }
    // Guardar mensaje y archivo en la base de datos para el historial de chat
    const ChatMessage = require('../models/ChatMessage');
    await ChatMessage.create({
      sender: 'user',
      userId: req.user ? req.user._id : null,
      message,
      fileUrl,
      extractedText,
      chatType: 'user'
    });
    const tamonResponse = `Tamon responde: ${message || ''} ${fileUrl ? '(Archivo recibido)' : ''}`;
    res.json({ response: tamonResponse, extractedText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
