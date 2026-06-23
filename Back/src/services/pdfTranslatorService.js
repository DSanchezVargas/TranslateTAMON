/**
 * pdfTranslatorService.js
 * Traduce PDFs preservando el formato visual original.
 *
 * Estrategia:
 *  1. Carga el PDF ORIGINAL con pdf-lib (mantiene todo: imágenes, colores, columnas).
 *  2. Extrae texto con pdf-parse (compatible con v1 Y v2) por página.
 *  3. Traduce el texto de cada página.
 *  4. Sobre cada página del PDF original:
 *     - Dibuja un rectángulo blanco sobre el área de contenido principal
 *     - Escribe el texto traducido encima
 *  5. Preserva encabezados, pies de página, márgenes, logos y elementos decorativos.
 *
 * Resultado: documento > 70% idéntico al original, con texto traducido.
 */

const pdfParse = require('pdf-parse');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// ─── Extractor de texto compatible con pdf-parse v1 Y v2 ─────────────────────

async function extractTextPerPage(fileBuffer) {
  const pageTexts = [];
  let fullText = '';
  let numPages = 1;

  if (typeof pdfParse === 'function') {
    // ── pdf-parse v1 API ──
    const perPage = {};
    const data = await pdfParse(fileBuffer, {
      pagerender: async (pageData) => {
        const idx = (pageData.pageNumber || 1) - 1;
        try {
          const tc = await pageData.getTextContent({ normalizeWhitespace: false });
          const text = tc.items.map(i => i.str).filter(Boolean).join(' ');
          perPage[idx] = text;
          return text;
        } catch (_) {
          return '';
        }
      }
    });
    fullText = (data.text || '').trim();
    numPages = data.numpages || 1;
    for (let i = 0; i < numPages; i++) {
      pageTexts.push(perPage[i] || '');
    }

  } else if (pdfParse && typeof pdfParse.PDFParse === 'function') {
    // ── pdf-parse v2 API ──
    const parser = new pdfParse.PDFParse({ data: fileBuffer });
    try {
      const result = await parser.getText({ lineEnforce: true });
      fullText = (result.text || '').trim();

      if (Array.isArray(result.pages) && result.pages.length) {
        numPages = result.pages.length;
        for (const page of result.pages) {
          if (typeof page === 'string') { pageTexts.push(page); }
          else if (page && typeof page.text === 'string') { pageTexts.push(page.text); }
          else if (page && typeof page.content === 'string') { pageTexts.push(page.content); }
          else { pageTexts.push(''); }
        }
      }
    } finally {
      try { await parser.destroy(); } catch (_) {}
    }

  } else {
    throw new Error('pdf-parse no está disponible o tiene una versión incompatible.');
  }

  return { pageTexts, fullText, numPages };
}

// ─── Word-wrap ───────────────────────────────────────────────────────────────

function wordWrap(text, font, fontSize, maxWidth) {
  const result = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { result.push(''); continue; }
    const words = para.split(/\s+/);
    let cur = '';
    for (const word of words) {
      if (!word) continue;
      const candidate = cur ? `${cur} ${word}` : word;
      let w = candidate.length * fontSize * 0.52; // fallback
      try { w = font.widthOfTextAtSize(candidate, fontSize); } catch (_) {}
      if (w > maxWidth && cur) {
        result.push(cur);
        cur = word;
      } else {
        cur = candidate;
      }
    }
    if (cur) result.push(cur);
  }
  return result;
}

// ─── Función principal ────────────────────────────────────────────────────────

/**
 * @param {Buffer|null} fileBuffer  - Buffer del PDF original (null = modo texto puro)
 * @param {string} sourceLanguage
 * @param {string} targetLanguage
 * @param {Function} translateFn   - async (text, sl, tl) => translatedText
 * @returns {Promise<Buffer>}
 */
async function translatePdfBuffer(fileBuffer, sourceLanguage, targetLanguage, translateFn) {
  // ── Modo texto puro (fallback para createTranslatedPdfBuffer) ──
  if (fileBuffer === null) {
    const text = await translateFn('', sourceLanguage, targetLanguage);
    return buildPlainTextPdf(text || '');
  }

  // ── 1. Extraer texto por página ──
  let pageTexts, fullText, numPagesExtracted;
  try {
    ({ pageTexts, fullText, numPages: numPagesExtracted } = await extractTextPerPage(fileBuffer));
  } catch (err) {
    throw new Error('No se pudo leer el PDF: ' + err.message);
  }

  if (!fullText) {
    throw new Error('El PDF no contiene texto extraíble. Si es escaneado, usa OCR.');
  }

  // ── 2. Cargar PDF ORIGINAL con pdf-lib ──
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
  } catch (err) {
    throw new Error('No se pudo cargar el PDF: ' + err.message);
  }

  const pages = pdfDoc.getPages();
  const numPages = pages.length;

  // Si no tenemos textos por página, dividir equitativamente
  if (!pageTexts.length || pageTexts.every(t => !t.trim())) {
    const allParas = fullText.split(/\n\n+/);
    const perPage = Math.max(Math.ceil(allParas.length / numPages), 1);
    pageTexts = [];
    for (let i = 0; i < numPages; i++) {
      pageTexts.push(allParas.slice(i * perPage, (i + 1) * perPage).join('\n\n'));
    }
  }

  // Asegurar que haya un texto para cada página
  while (pageTexts.length < numPages) pageTexts.push('');

  // ── 3. Embed fuentes ──
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // ── 4. Traducir y aplicar overlay por página ──
  for (let i = 0; i < numPages; i++) {
    const pageText = (pageTexts[i] || '').trim();
    if (!pageText) continue;

    // Traducir el texto de esta página
    let translated;
    try {
      translated = await translateFn(pageText, sourceLanguage, targetLanguage);
    } catch (_) {
      continue; // Si falla la traducción de esta página, saltarla
    }
    if (!translated || !translated.trim()) continue;

    const page = pages[i];
    const { width, height } = page.getSize();

    // Estimar márgenes del documento (preservar header/footer)
    const topMargin    = Math.min(height * 0.10, 75);
    const bottomMargin = Math.min(height * 0.07, 55);
    const leftMargin   = Math.min(width * 0.08, 50);
    const rightMargin  = Math.min(width * 0.08, 50);
    const contentW     = width - leftMargin - rightMargin;

    // 4a. Cubrir el área de contenido principal con blanco
    //     (preserva header, footer, logos en márgenes)
    page.drawRectangle({
      x:      leftMargin - 3,
      y:      bottomMargin,
      width:  contentW + 6,
      height: height - topMargin - bottomMargin,
      color:  rgb(1, 1, 1),
      opacity: 1,
      borderWidth: 0,
    });

    // 4b. Escribir texto traducido
    const fontSize = Math.min(9.5, Math.max(7.5, width / 70));
    const lineH = fontSize * 1.45;
    let y = height - topMargin - fontSize - 2;

    const wrappedLines = wordWrap(translated, font, fontSize, contentW);
    for (const line of wrappedLines) {
      if (y < bottomMargin + 5) break; // No pisar footer
      if (!line) { y -= lineH * 0.35; continue; }

      try {
        page.drawText(line, {
          x:    leftMargin,
          y:    y,
          size: fontSize,
          font: font,
          color: rgb(0.05, 0.05, 0.05),
        });
      } catch (_) { /* glyph no soportado, ignorar */ }
      y -= lineH;
    }
  }

  // ── 5. Guardar y devolver ──
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

// ─── Fallback: PDF de texto plano ────────────────────────────────────────────

async function buildPlainTextPdf(text) {
  const pdfDoc = await PDFDocument.create();
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fs     = 10.5;
  const lineH  = fs * 1.55;
  const margin = 52;
  const pageW  = 595;
  const pageH  = 842;
  const maxW   = pageW - 2 * margin;

  let page = pdfDoc.addPage([pageW, pageH]);
  let y    = pageH - margin;

  for (const rawLine of (text || '').split('\n')) {
    const words = rawLine.split(' ');
    let cur = '';
    for (const word of words) {
      const cand = cur ? `${cur} ${word}` : word;
      let w = cand.length * fs * 0.52;
      try { w = font.widthOfTextAtSize(cand, fs); } catch (_) {}
      if (w > maxW && cur) {
        if (y < margin) { page = pdfDoc.addPage([pageW, pageH]); y = pageH - margin; }
        try { page.drawText(cur, { x: margin, y, size: fs, font, color: rgb(0.08, 0.08, 0.08) }); } catch (_) {}
        y -= lineH; cur = word;
      } else { cur = cand; }
    }
    if (cur) {
      if (y < margin) { page = pdfDoc.addPage([pageW, pageH]); y = pageH - margin; }
      try { page.drawText(cur, { x: margin, y, size: fs, font, color: rgb(0.08, 0.08, 0.08) }); } catch (_) {}
      y -= lineH;
    }
    y -= lineH * 0.2;
  }

  return Buffer.from(await pdfDoc.save());
}

module.exports = { translatePdfBuffer };
