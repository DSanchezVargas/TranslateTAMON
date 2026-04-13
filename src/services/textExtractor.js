const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const path = require('path');
const { getTesseractLang } = require('../config/languages');

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.jpg', '.jpeg', '.png', '.txt']);

function getExtension(fileName = '') {
  return path.extname(fileName).toLowerCase();
}

function assertSupportedFile(fileName) {
  const extension = getExtension(fileName);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('Formato no soportado. Usa PDF, DOCX, JPG, JPEG, PNG o TXT.');
  }
  return extension;
}

async function extractTextFromPdf(buffer, sourceLanguage) {
  let result;

  // pdf-parse v1 exports a function; v2 exports a PDFParse class.
  if (typeof pdfParse === 'function') {
    result = await pdfParse(buffer);
  } else if (pdfParse && typeof pdfParse.PDFParse === 'function') {
    const parser = new pdfParse.PDFParse({ data: buffer });
    try {
      result = await parser.getText({ lineEnforce: true });

      if (Array.isArray(result?.pages) && result.pages.length) {
        await enhancePdfTextWithOcr(parser, result.pages, sourceLanguage);
        result.text = joinPdfPages(result.pages);
      }
    } finally {
      await parser.destroy();
    }
  } else {
    throw new Error('Integracion de PDF no compatible con la version instalada de pdf-parse.');
  }

  const text = (result.text || '').trim();

  if (!text) {
    throw new Error('No se pudo extraer texto del PDF. Si es escaneado, configura OCR especializado para PDF.');
  }

  return text;
}

async function extractTextFromDocx(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  const text = (result.value || '').trim();
  if (!text) {
    throw new Error('El archivo DOCX no contiene texto legible.');
  }
  return text;
}

async function extractTextFromImage(buffer, sourceLanguage) {
  const tesseractLang = getTesseractLang(sourceLanguage);
  const result = await Tesseract.recognize(buffer, tesseractLang);
  const text = (result.data?.text || '').trim();

  if (!text) {
    throw new Error('No se detectó texto en la imagen.');
  }

  return text;
}

function extractTextFromTxt(buffer) {
  const text = buffer.toString('utf8').trim();
  if (!text) {
    throw new Error('El archivo TXT no contiene texto legible.');
  }
  return text;
}

async function extractTextByFile(file, sourceLanguage) {
  if (!file || !file.buffer) {
    throw new Error('Archivo inválido o vacío.');
  }

  const extension = assertSupportedFile(file.originalname);

  if (extension === '.pdf') return extractTextFromPdf(file.buffer, sourceLanguage);
  if (extension === '.docx') return extractTextFromDocx(file.buffer);
  if (extension === '.jpg' || extension === '.jpeg' || extension === '.png') {
    return extractTextFromImage(file.buffer, sourceLanguage);
  }
  if (extension === '.txt') return extractTextFromTxt(file.buffer);

  throw new Error('Formato no soportado.');
}

module.exports = {
  extractTextByFile,
  assertSupportedFile
};
