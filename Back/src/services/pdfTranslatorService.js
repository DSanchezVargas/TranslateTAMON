/**
 * pdfTranslatorService.js
 * Traduce PDFs 100% en Node.js sin necesidad del microservicio Python.
 * Usa pdf-parse para extraer texto y pdf-lib para reconstruir el PDF traducido.
 */

const pdfParse = require('pdf-parse');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

/**
 * Traduce un buffer de PDF y devuelve un nuevo buffer PDF con el texto traducido.
 * @param {Buffer} fileBuffer - Buffer del PDF original
 * @param {string} sourceLanguage - Código de idioma origen (ej: 'en')
 * @param {string} targetLanguage - Código de idioma destino (ej: 'es')
 * @param {Function} translateFn - Función de traducción: (text, sl, tl) => Promise<string>
 * @returns {Promise<Buffer>} Buffer del PDF traducido
 */
async function translatePdfBuffer(fileBuffer, sourceLanguage, targetLanguage, translateFn) {
  let translatedText;

  if (fileBuffer === null) {
    // Modo texto puro: translateFn devuelve el texto ya listo (sin extraer del PDF)
    translatedText = await translateFn('', sourceLanguage, targetLanguage);
  } else {
    // 1. Extraer texto del PDF original
    let pdfData;
    try {
      pdfData = await pdfParse(fileBuffer);
    } catch (err) {
      throw new Error('No se pudo leer el PDF: ' + err.message);
    }

    const fullText = (pdfData.text || '').trim();
    if (!fullText) {
      throw new Error('El PDF no contiene texto extraíble. Si es un PDF escaneado, usa OCR.');
    }

    // 2. Traducir el texto completo
    translatedText = await translateFn(fullText, sourceLanguage, targetLanguage);

    if (!translatedText || !translatedText.trim()) {
      throw new Error('El servicio de traducción no devolvió contenido válido.');
    }
  }

  // 3. Reconstruir el PDF con el texto traducido
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const fontSize = 10.5;
  const titleFontSize = 14;
  const margin = 52;
  const lineHeight = fontSize * 1.55;
  const pageWidth = 595;  // A4
  const pageHeight = 842; // A4
  const maxTextWidth = pageWidth - 2 * margin;

  /**
   * Parte el texto en líneas que caben en el ancho máximo.
   */
  function wrapLine(text, fnt, fSize) {
    const words = text.split(' ');
    const lines = [];
    let current = '';

    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      const w = fnt.widthOfTextAtSize(candidate, fSize);
      if (w > maxTextWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines;
  }

  let page = pdfDoc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  /**
   * Dibuja texto en la página actual, crea nueva página si es necesario.
   */
  function drawLine(text, fnt, fSize, color = rgb(0.08, 0.08, 0.08)) {
    if (y < margin + fSize) {
      page = pdfDoc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
    }
    page.drawText(text, { x: margin, y, size: fSize, font: fnt, color });
    y -= fSize * 1.55;
  }

  // Separar párrafos del texto traducido
  const paragraphs = translatedText.split(/\n+/);

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i].trim();

    if (!para) {
      // Línea en blanco → salto de párrafo
      y -= lineHeight * 0.4;
      if (y < margin) {
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
      }
      continue;
    }

    // Detectar posible encabezado: línea corta sola (< 80 chars, sin punto al final)
    const looksLikeHeading = para.length < 80 && !para.endsWith('.') && !para.endsWith(',');
    const isFirst = i === 0;

    const usedFont = (isFirst || looksLikeHeading) ? boldFont : font;
    const usedSize = (isFirst || looksLikeHeading) ? titleFontSize : fontSize;

    const wrappedLines = wrapLine(para, usedFont, usedSize);
    for (const line of wrappedLines) {
      drawLine(line, usedFont, usedSize);
    }

    // Espaciado extra tras encabezado
    if (isFirst || looksLikeHeading) {
      y -= lineHeight * 0.3;
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

module.exports = { translatePdfBuffer };
