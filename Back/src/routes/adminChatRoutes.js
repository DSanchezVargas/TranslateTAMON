const express = require('express');
const { requireAdmin } = require('../middleware/auth');
const router = express.Router();

// Chat especial para admin enseñando a Tamon
const { extractTextFromFile } = require('../services/fileTextExtractor');

router.post('/chat', requireAdmin, async (req, res) => {
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
    // Guardar mensaje y archivo en la base de datos para el historial de "enseñanza"
    const ChatMessage = require('../models/ChatMessage');
    await ChatMessage.create({
      sender: 'admin',
      userId: req.user ? req.user._id : null,
      message,
      fileUrl,
      extractedText,
      chatType: 'admin'
    });
    const tamonResponse = `Aprendido: ${message || ''} ${fileUrl ? '(Archivo recibido)' : ''}`;
    res.json({ response: tamonResponse, extractedText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
