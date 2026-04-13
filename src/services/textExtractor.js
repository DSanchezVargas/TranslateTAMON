const mammoth = require('mammoth');
const pdfParse = require('pdf-parse');
const Tesseract = require('tesseract.js');
const path = require('path');
const { getTesseractLang } = require('../config/languages');

const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.jpg', '.jpeg', '.png']);
const PDF_PAGE_MIN_TEXT_LENGTH = 100;
const PDF_OCR_MAX_PAGES = Number(process.env.PDF_OCR_MAX_PAGES || 40);

function compactText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function joinPdfPages(pages) {
  return pages
    .map((page) => page.text || '')
    .filter((pageText) => pageText.trim())
    .join('\n\n');
}

function mergeNativeAndOcr(nativeText, ocrText) {
  const nativeCompact = compactText(nativeText);
  const ocrCompact = compactText(ocrText);
  if (!ocrCompact) return nativeCompact;
  if (!nativeCompact) return ocrCompact;

  // Si OCR ya contiene el texto nativo, usar OCR completo.
  if (ocrCompact.includes(nativeCompact)) return ocrCompact;

  // Si el nativo ya cubre OCR, mantener nativo.
  if (nativeCompact.includes(ocrCompact)) return nativeCompact;

  // Complementar para no perder bloques de texto de ninguna fuente.
  return `${nativeCompact}\n${ocrCompact}`;
}

async function runOcrOnPdfPage(parser, pageNumber, sourceLanguage) {
  const screenshot = await parser.getScreenshot({
    partial: [pageNumber],
    desiredWidth: 1400,
    imageBuffer: true,
    imageDataUrl: false
  });

  const pageImage = screenshot?.pages?.[0]?.data;
  if (!pageImage) return '';

  const tesseractLang = getTesseractLang(sourceLanguage);
  const ocr = await Tesseract.recognize(Buffer.from(pageImage), tesseractLang);
  return compactText(ocr.data?.text || '');
}

async function enhancePdfTextWithOcr(parser, pages, sourceLanguage) {
  const candidates = pages
    .filter((page) => compactText(page.text).length < PDF_PAGE_MIN_TEXT_LENGTH)
    .slice(0, PDF_OCR_MAX_PAGES);

  for (const page of candidates) {
    try {
      const ocrText = await runOcrOnPdfPage(parser, page.num, sourceLanguage);
      const nativeText = compactText(page.text);
      page.text = mergeNativeAndOcr(nativeText, ocrText);
    } catch (error) {
      void error;
    }
  }

  return pages;
}

function getExtension(fileName = '') {
  return path.extname(fileName).toLowerCase();
}

function assertSupportedFile(fileName) {
  const extension = getExtension(fileName);
  if (!SUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error('Formato no soportado. Usa PDF, DOCX, JPG, JPEG o PNG.');
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

  throw new Error('Formato no soportado.');
}

module.exports = {
  extractTextByFile,
  assertSupportedFile
};
