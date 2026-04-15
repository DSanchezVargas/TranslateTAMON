const Tesseract = require('tesseract.js');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const fs = require('fs');
const path = require('path');

async function extractTextFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.pdf') {
    const dataBuffer = fs.readFileSync(filePath);
    try {
      const data = await pdfParse(dataBuffer);
      if (data.text && data.text.trim().length > 0) {
        return data.text;
      }
      // Si el PDF no tiene texto, intentar OCR
      return await extractTextFromImage(filePath);
    } catch (e) {
      // Si falla pdf-parse, intentar OCR
      return await extractTextFromImage(filePath);
    }
  } else if (ext === '.docx') {
    const data = await mammoth.extractRawText({ path: filePath });
    return data.value;
  } else if (['.jpg', '.jpeg', '.png', '.bmp', '.tiff'].includes(ext)) {
    return await extractTextFromImage(filePath);
  } else {
    throw new Error('Tipo de archivo no soportado para extracción de texto.');
  }
}

async function extractTextFromImage(filePath) {
  const { data: { text } } = await Tesseract.recognize(filePath, 'eng+spa');
  return text;
}

module.exports = { extractTextFromFile };
