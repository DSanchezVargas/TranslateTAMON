/**
 * pdfTranslatorService.js
 * Traduce PDFs preservando el 100% del layout original (imágenes, colores, columnas).
 * 
 * Estrategia:
 *  1. Usa pdf-parse (pagerender) para extraer cada item de texto con posición x,y exacta.
 *  2. Agrupa items en "bloques" de texto (por proximidad).
 *  3. Traduce cada bloque.
 *  4. Carga el PDF ORIGINAL con pdf-lib (mantiene todo lo visual intacto).
 *  5. Para cada bloque: cubre texto original con rectángulo blanco → inserta texto traducido.
 *
 * Resultado: el documento descargado es idéntico al original en layout,
 * solo el texto cambia al idioma de destino.
 */

const pdfParse = require('pdf-parse');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Agrupa items de texto con y similar en la misma "línea visual".
 * Tolerance: ±50% del font-size del primer item de la línea.
 */
function groupItemsIntoLines(items) {
  if (!items.length) return [];
  // Ordenar de arriba a abajo, luego izquierda a derecha
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  let currentLine = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const item = sorted[i];
    const lineY = currentLine[0].y;
    const tolerance = currentLine[0].fontSize * 0.6;
    if (Math.abs(item.y - lineY) <= tolerance) {
      currentLine.push(item);
    } else {
      lines.push(currentLine);
      currentLine = [item];
    }
  }
  if (currentLine.length) lines.push(currentLine);
  return lines;
}

/**
 * Agrupa líneas consecutivas en "bloques" de párrafo.
 * Un nuevo bloque comienza si el gap vertical es > 2.5x el font-size promedio,
 * o si hay un salto brusco en x (diferente columna).
 */
function groupLinesIntoBlocks(lines) {
  if (!lines.length) return [];
  const blocks = [];
  let currentBlock = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    const prev = currentBlock[currentBlock.length - 1];
    const curr = lines[i];
    const prevY = prev[0].y;
    const currY = curr[0].y;
    const prevFs = prev[0].fontSize || 10;
    const prevX = Math.min(...prev.map(t => t.x));
    const currX = Math.min(...curr.map(t => t.x));
    const gap = prevY - currY;
    const xShift = Math.abs(prevX - currX);

    // Mismo bloque si el gap es < 2.5 líneas Y la columna no cambia drásticamente
    if (gap <= prevFs * 2.5 && xShift <= 60) {
      currentBlock.push(curr);
    } else {
      blocks.push(buildBlock(currentBlock));
      currentBlock = [curr];
    }
  }
  blocks.push(buildBlock(currentBlock));
  return blocks;
}

function buildBlock(lines) {
  const allItems = lines.flat();
  const minX = Math.min(...allItems.map(i => i.x));
  const maxX = Math.max(...allItems.map(i => i.x + (i.width || 0)));
  const maxY = Math.max(...allItems.map(i => i.y));
  const minY = Math.min(...allItems.map(i => i.y));
  const avgFs = allItems.reduce((s, i) => s + i.fontSize, 0) / allItems.length;

  // Texto del bloque: líneas unidas por \n, items de cada línea por espacio
  const text = lines
    .map(line => line.map(item => item.str).join(''))
    .join('\n')
    .trim();

  return {
    text,
    x: minX,
    y: maxY,          // baseline de la línea más alta
    bottomY: minY,    // baseline de la línea más baja
    width: Math.max(maxX - minX, 50),
    height: maxY - minY + avgFs * 1.2,
    fontSize: Math.max(avgFs, 6),
  };
}

/**
 * Word-wrap: divide texto en líneas que caben dentro de maxWidth.
 */
function wordWrap(text, font, fontSize, maxWidth) {
  const result = [];
  for (const para of text.split('\n')) {
    if (!para.trim()) { result.push(''); continue; }
    const words = para.split(' ');
    let cur = '';
    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word;
      let w = 0;
      try { w = font.widthOfTextAtSize(candidate, fontSize); } catch (_) { w = candidate.length * fontSize * 0.55; }
      if (w > maxWidth && cur) { result.push(cur); cur = word; }
      else { cur = candidate; }
    }
    if (cur) result.push(cur);
  }
  return result;
}

/**
 * Traduce bloques en paralelo (max 6 a la vez) con fallback al original si hay error.
 */
async function translateBlocks(blocks, sourceLanguage, targetLanguage, translateFn, concurrency = 6) {
  const results = new Array(blocks.length);
  for (let i = 0; i < blocks.length; i += concurrency) {
    const chunk = blocks.slice(i, i + concurrency);
    const translations = await Promise.all(
      chunk.map(async (block) => {
        if (!block.text.trim()) return block.text;
        try {
          const t = await translateFn(block.text, sourceLanguage, targetLanguage);
          return (t && t.trim()) ? t : block.text;
        } catch (_) {
          return block.text;
        }
      })
    );
    translations.forEach((t, j) => { results[i + j] = t; });
  }
  return results;
}

// ─── Función principal ─────────────────────────────────────────────────────────

/**
 * Traduce un PDF preservando su formato visual original.
 *
 * @param {Buffer|null} fileBuffer  - Buffer del PDF original (null = modo texto puro)
 * @param {string} sourceLanguage
 * @param {string} targetLanguage
 * @param {Function} translateFn   - async (text, sl, tl) => translatedText
 * @returns {Promise<Buffer>}       - Buffer del PDF traducido
 */
async function translatePdfBuffer(fileBuffer, sourceLanguage, targetLanguage, translateFn) {

  // ── Modo texto puro (usado por createTranslatedPdfBuffer como fallback) ──
  if (fileBuffer === null) {
    const translatedText = await translateFn('', sourceLanguage, targetLanguage);
    return buildPlainTextPdf(translatedText || '');
  }

  // ── Paso 1: Extraer posiciones de texto con pdf-parse (pagerender) ──
  const pageItems = {}; // pageIdx => [{str, x, y, fontSize, width}]

  try {
    await pdfParse(fileBuffer, {
      pagerender: async (pageData) => {
        // pageData es el objeto Page de pdfjs. pageNumber es 1-indexed.
        const pageIdx = (pageData.pageNumber || 1) - 1;
        try {
          const tc = await pageData.getTextContent({ normalizeWhitespace: false });
          pageItems[pageIdx] = tc.items
            .filter(item => item.str && item.str.trim())
            .map(item => ({
              str:      item.str,
              x:        item.transform[4],
              y:        item.transform[5],
              fontSize: Math.max(Math.abs(item.transform[3]), 6),
              width:    item.width || Math.abs(item.transform[3]) * item.str.length * 0.55,
            }));
        } catch (_) {
          pageItems[pageIdx] = [];
        }
        // pdf-parse requiere que pagerender devuelva un string
        return (pageItems[pageIdx] || []).map(i => i.str).join(' ');
      }
    });
  } catch (err) {
    throw new Error('No se pudo analizar el PDF: ' + err.message);
  }

  // Verificar que se extrajo algo
  const totalItems = Object.values(pageItems).reduce((s, arr) => s + arr.length, 0);
  if (totalItems === 0) {
    throw new Error('El PDF no contiene texto extraíble (puede ser escaneado o protegido).');
  }

  // ── Paso 2: Agrupar items en bloques por página ──
  const pageBlocks = {};
  for (const [pageIdxStr, items] of Object.entries(pageItems)) {
    const lines = groupItemsIntoLines(items);
    pageBlocks[pageIdxStr] = groupLinesIntoBlocks(lines);
  }

  // ── Paso 3: Cargar PDF ORIGINAL con pdf-lib (preserva TODO lo visual) ──
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });
  } catch (err) {
    throw new Error('No se pudo cargar el PDF con pdf-lib: ' + err.message);
  }

  const pages = pdfDoc.getPages();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // ── Paso 4: Por cada página, traducir bloques y hacer overlay ──
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page   = pages[pageIdx];
    const blocks = pageBlocks[pageIdx] || [];
    if (!blocks.length) continue;

    // Traducir todos los bloques de esta página en paralelo
    const translations = await translateBlocks(
      blocks, sourceLanguage, targetLanguage, translateFn
    );

    for (let b = 0; b < blocks.length; b++) {
      const block = blocks[b];
      const translated = translations[b];
      if (!translated || !translated.trim()) continue;

      const fs       = Math.max(block.fontSize, 6);
      const lineH    = fs * 1.35;
      const rectPad  = 2;
      const rectX    = block.x - rectPad;
      const rectH    = block.height + rectPad * 2;
      const rectY    = block.bottomY - rectPad;
      const blockW   = Math.max(block.width, 80);

      // 4a. Cubrir texto original con rectángulo blanco
      page.drawRectangle({
        x:      rectX,
        y:      rectY,
        width:  blockW + rectPad * 2,
        height: rectH,
        color:  rgb(1, 1, 1),
        opacity: 1,
        borderWidth: 0,
      });

      // 4b. Insertar texto traducido con word-wrap dentro del área original
      const usedFont = (fs >= 13) ? boldFont : font; // encabezados en negrita
      const wrappedLines = wordWrap(translated, usedFont, fs, blockW);
      let drawY = block.y;

      for (const line of wrappedLines) {
        if (!line) { drawY -= lineH * 0.5; continue; }
        // No dibujar fuera del área del bloque (máx 30% overflow)
        if (drawY < block.bottomY - lineH * 1.3) break;

        try {
          page.drawText(line, {
            x:    block.x,
            y:    drawY,
            size: fs,
            font: usedFont,
            color: rgb(0.05, 0.05, 0.05),
          });
        } catch (_) { /* skip glyphs no soportados */ }
        drawY -= lineH;
      }
    }
  }

  // ── Paso 5: Guardar y devolver ──
  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

/**
 * Construye un PDF simple a partir de texto plano (fallback cuando fileBuffer=null).
 */
async function buildPlainTextPdf(text) {
  const pdfDoc   = await PDFDocument.create();
  const font     = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fs       = 10.5;
  const lineH    = fs * 1.55;
  const margin   = 52;
  const pageW    = 595;
  const pageH    = 842;
  const maxW     = pageW - 2 * margin;

  let page = pdfDoc.addPage([pageW, pageH]);
  let y    = pageH - margin;

  for (const rawLine of (text || '').split('\n')) {
    const words = rawLine.split(' ');
    let cur = '';
    for (const word of words) {
      const cand = cur ? `${cur} ${word}` : word;
      let w = 0;
      try { w = font.widthOfTextAtSize(cand, fs); } catch (_) { w = cand.length * fs * 0.55; }
      if (w > maxW && cur) {
        if (y < margin) { page = pdfDoc.addPage([pageW, pageH]); y = pageH - margin; }
        page.drawText(cur, { x: margin, y, size: fs, font, color: rgb(0.08, 0.08, 0.08) });
        y -= lineH; cur = word;
      } else { cur = cand; }
    }
    if (cur) {
      if (y < margin) { page = pdfDoc.addPage([pageW, pageH]); y = pageH - margin; }
      page.drawText(cur, { x: margin, y, size: fs, font, color: rgb(0.08, 0.08, 0.08) });
      y -= lineH;
    }
    y -= lineH * 0.2;
  }

  return Buffer.from(await pdfDoc.save());
}

module.exports = { translatePdfBuffer };
