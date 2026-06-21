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

// AÑADE ESTA FUNCIÓN PARA EVITAR EL CRASH:
async function enhancePdfTextWithOcr(parser, pages, sourceLanguage) {
  // Por el momento, dejamos que pdf-parse extraiga el texto nativo del PDF.
  // Aquí podrás integrar Tesseract para PDFs escaneados en el futuro.
  return;
}

// REEMPLAZA TU FUNCIÓN ACTUAL POR ESTA VERSIÓN:
function joinPdfPages(pages) {
  if (!Array.isArray(pages)) return '';
  
  return pages.map(page => {
    // Si la página ya es un texto simple, lo usamos.
    if (typeof page === 'string') return page;
    // Si es un objeto, extraemos la propiedad que contiene el texto.
    if (page && typeof page.text === 'string') return page.text;
    if (page && typeof page.content === 'string') return page.content;
    return '';
  }).filter(Boolean).join('\n\n'); 
}

async function extractTextFromPdf(buffer, sourceLanguage) {
  let result;
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

  let text = (result.text || '').trim();

  // Si no hay texto, intenta OCR con microservicio Python
  if (!text) {
    try {
      const { extractPdfTextWithOcrPython } = require('./pdfOcrClient');
      text = await extractPdfTextWithOcrPython(buffer, 'input.pdf');
      if (!text) throw new Error('OCR vacío');
    } catch (err) {
      throw new Error('No se pudo extraer texto del PDF. Si es escaneado, configura OCR especializado para PDF. Detalle: ' + err.message);
    }
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