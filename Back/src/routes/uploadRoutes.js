const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Configuración de almacenamiento para archivos subidos
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath);
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 5120 * 1024 * 1024 } // 5 GB limit in multer global parser
});

const { extractTextFromFile } = require('../services/fileTextExtractor');

// Endpoint para subir archivos (Word, PDF, imagen) y extraer texto
router.post('/upload', upload.single('file'), async (req, res) => {
  const userPlan = req.user ? req.user.plan : 'free';
  const isPro = userPlan === 'pro_plus' || userPlan === 'pro' || (req.user && req.user.role === 'admin');
  const maxSizeMB = isPro ? 5120 : 1024;
  if (!req.file) {
    return res.status(400).json({ error: 'No se subió ningún archivo.' });
  }
  if (req.file.size > maxSizeMB * 1024 * 1024) {
    const displaySize = isPro ? '5 GB' : '1 GB';
    return res.status(400).json({ error: `El archivo supera el límite de ${displaySize} para tu tipo de usuario (${userPlan === 'free' ? 'Tamon Chill' : 'Tamon Pro+'}).` });
  }
  let extracted = { text: '', type: '' };
  try {
    extracted = await extractTextFromFile(req.file.path);
  } catch (e) {
    extracted = { text: '', type: '' };
  }
  res.status(201).json({
    message: 'Archivo subido correctamente.',
    fileUrl: `/uploads/${req.file.filename}`,
    originalName: req.file.originalname,
    extractedText: extracted.text,
    detectedType: extracted.type,
    userType,
    maxSizeMB
  });
});

module.exports = router;
