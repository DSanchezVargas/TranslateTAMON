from flask import Flask, request, send_file, jsonify
import tempfile
import os
import fitz  # PyMuPDF
from PIL import Image, ImageDraw, ImageFont
import pytesseract
import json
import requests
import urllib.parse
import re

import string

if os.path.exists(r'C:\Program Files\Tesseract-OCR\tesseract.exe'):
    pytesseract.pytesseract.tesseract_cmd = r'C:\Program Files\Tesseract-OCR\tesseract.exe'


def es_texto_corrupto(texto):
    if not texto or len(texto.strip()) < 8:
        return False
    letras = sum(1 for c in texto if c.isalpha())
    total_non_space = len(texto.replace(" ", "").replace("\n", "").replace("\r", ""))
    if total_non_space == 0:
        return False
    ratio_letras = letras / total_non_space
    return ratio_letras < 0.55

app = Flask(__name__)

# --- Endpoint 1: Extraer textos de imágenes del PDF ---
@app.route('/extraer-textos-pdf', methods=['POST'])
def extraer_textos_pdf():
    file = request.files['file']
    textos = []
    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, 'input.pdf')
        file.save(input_path)
        doc = fitz.open(input_path)
        for page_num in range(len(doc)):
            page = doc[page_num]
            images = page.get_images(full=True)
            for img_index, img in enumerate(images):
                xref = img[0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                img_ext = base_image["ext"]
                img_path = os.path.join(tmpdir, f"page{page_num}_img{img_index}.{img_ext}")
                with open(img_path, "wb") as img_file:
                    img_file.write(image_bytes)
                pil_img = Image.open(img_path)
                texto = pytesseract.image_to_string(pil_img)
                textos.append({
                    "page": page_num,
                    "img_index": img_index,
                    "texto": texto
                })
        doc.close()
    return jsonify({"textos": textos})

# --- Endpoint 2: Insertar textos traducidos sobre imágenes y devolver PDF ---
@app.route('/insertar-textos-pdf', methods=['POST'])
def insertar_textos_pdf():
    file = request.files['file']
    textos_json = request.form['textos']  # Recibe un JSON con los textos traducidos
    textos = json.loads(textos_json)
    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, 'input.pdf')
        output_path = os.path.join(tmpdir, 'output.pdf')
        file.save(input_path)
        doc = fitz.open(input_path)
        for t in textos:
            page_num = t['page']
            img_index = t['img_index']
            texto_traducido = t['texto']
            page = doc[page_num]
            images = page.get_images(full=True)
            if img_index < len(images):
                xref = images[img_index][0]
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                img_ext = base_image["ext"]
                img_path = os.path.join(tmpdir, f"page{page_num}_img{img_index}.{img_ext}")
                img_out_path = os.path.join(tmpdir, f"page{page_num}_img{img_index}_out.{img_ext}")
                with open(img_path, "wb") as img_file:
                    img_file.write(image_bytes)
                # Detección avanzada de áreas de texto y reemplazo automatizado
                imagen = Image.open(img_path).convert("RGB")
                draw = ImageDraw.Draw(imagen)
                data = pytesseract.image_to_data(imagen, output_type=pytesseract.Output.DICT)
                palabras_traducidas = texto_traducido.split()  # Divide el texto traducido en palabras
                idx = 0
                for i, word in enumerate(data['text']):
                    if word.strip() != "" and idx < len(palabras_traducidas):
                        x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
                        # Borra el texto original (opcional)
                        draw.rectangle([x, y, x + w, y + h], fill="white")
                        try:
                            font = ImageFont.truetype("arial.ttf", h)
                        except:
                            font = ImageFont.load_default()
                        # Dibuja la palabra traducida en la posición original
                        draw.text((x, y), palabras_traducidas[idx], fill="black", font=font)
                        idx += 1
                imagen.save(img_out_path)
                # Reemplazar la imagen original por la modificada en el PDF
                with open(img_out_path, "rb") as img_file:
                    img_bytes = img_file.read()
                # Elimina la imagen original y la reemplaza
                page._delete_image(xref)
                page.insert_image(page.get_image_bbox(xref), stream=img_bytes)
        # Guardar el PDF modificado
        doc.save(output_path)
        doc.close()
        
        import io
        with open(output_path, "rb") as f:
            pdf_bytes = f.read()
            
        return send_file(
            io.BytesIO(pdf_bytes),
            mimetype="application/pdf",
            as_attachment=True,
            download_name="output.pdf"
        )

# --- Endpoint 3: Convertir texto traducido plano a PDF ---
@app.route('/convertir-texto-pdf', methods=['POST'])
def convertir_texto_pdf():
    data = request.get_json() or {}
    texto = data.get('texto', '')
    titulo = data.get('titulo', 'Documento Traducido')
    
    doc = fitz.open()
    page = doc.new_page()
    
    margin = 50
    width = page.rect.width - (2 * margin)
    
    y = margin
    page.insert_text((margin, y), titulo, fontsize=16, color=(0.917, 0.658, 0.756)) # primary color #eaa8c1
    y += 40
    
    for paragraph in texto.split('\n'):
        words = paragraph.split(' ')
        line_words = []
        for word in words:
            test_line = ' '.join(line_words + [word])
            approx_width = len(test_line) * 5.5
            if approx_width > width:
                if y > (page.rect.height - margin):
                    page = doc.new_page()
                    y = margin
                page.insert_text((margin, y), ' '.join(line_words), fontsize=10)
                y += 15
                line_words = [word]
            else:
                line_words.append(word)
        if line_words:
            if y > (page.rect.height - margin):
                page = doc.new_page()
                y = margin
            page.insert_text((margin, y), ' '.join(line_words), fontsize=10)
            y += 15
        y += 8
        
    with tempfile.TemporaryDirectory() as tmpdir:
        out_path = os.path.join(tmpdir, 'translated.pdf')
        doc.save(out_path)
        return send_file(out_path, as_attachment=True, download_name="translated.pdf")

# --- Helper: Traducir texto individual en Python ---
def traducir_texto_py(text, sl, tl):
    if not text.strip():
        return text
    try:
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl={sl}&tl={tl}&dt=t&q={urllib.parse.quote(text)}"
        res = requests.get(url, timeout=12)
        if res.status_code == 200:
            data = res.json()
            if data and data[0]:
                translated = ''.join([item[0] for item in data[0] if item[0]])
                return translated
        return text
    except Exception as e:
        print("Error en traducción python:", e)
        return text

# --- Endpoint 4: Traducir PDF preservando formato ---
@app.route('/procesar-pdf-formato', methods=['POST'])
def procesar_pdf_formato():
    try:
        file = request.files['file']
        sl = request.form.get('sourceLanguage', 'en')
        tl = request.form.get('targetLanguage', 'es')
        
        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = os.path.join(tmpdir, 'input.pdf')
            output_path = os.path.join(tmpdir, 'output.pdf')
            file.save(input_path)
            
            doc = fitz.open(input_path)
            for page_num in range(len(doc)):
                page = doc[page_num]
                
                # Check if page has corrupt text or is empty (scanned image)
                page_text = page.get_text("text")
                
                use_ocr = False
                if es_texto_corrupto(page_text):
                    use_ocr = True
                elif len(page_text.strip()) < 5:
                    # Page has no/very little text. Let's see if there are images or drawings
                    images = page.get_images(full=True)
                    drawings = page.get_drawings()
                    if images or drawings:
                        use_ocr = True
                
                page_translations = []
                
                if use_ocr:
                    try:
                        # Render page at 144 dpi (matrix=2)
                        pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                        img_data = pix.tobytes("png")
                        
                        import io
                        pil_img = Image.open(io.BytesIO(img_data))
                        
                        scale_x = pix.width / page.rect.width
                        scale_y = pix.height / page.rect.height
                        
                        data = pytesseract.image_to_data(pil_img, output_type=pytesseract.Output.DICT)
                        
                        # Group words by block and line
                        blocks = {}
                        n_items = len(data.get('level', []))
                        for i in range(n_items):
                            text = data['text'][i]
                            conf = float(data['conf'][i]) if data['conf'][i] is not None else -1
                            if conf < 30 or not text.strip():  # filter out low confidence and whitespace
                                continue
                            
                            b_num = data['block_num'][i]
                            l_num = data['line_num'][i]
                            
                            x, y, w, h = data['left'][i], data['top'][i], data['width'][i], data['height'][i]
                            
                            pdf_x = x / scale_x
                            pdf_y = y / scale_y
                            pdf_w = w / scale_x
                            pdf_h = h / scale_y
                            
                            word_info = {
                                "text": text,
                                "rect": fitz.Rect(pdf_x, pdf_y, pdf_x + pdf_w, pdf_y + pdf_h),
                                "font_size": pdf_h
                            }
                            
                            if b_num not in blocks:
                                blocks[b_num] = {}
                            if l_num not in blocks[b_num]:
                                blocks[b_num][l_num] = []
                            blocks[b_num][l_num].append(word_info)
                        
                        for b_num in sorted(blocks.keys()):
                            # Reconstruct block text
                            line_texts = []
                            for l_num in sorted(blocks[b_num].keys()):
                                line_words = blocks[b_num][l_num]
                                line_words.sort(key=lambda w: w["rect"].x0)
                                line_text = " ".join([w["text"] for w in line_words])
                                line_texts.append(line_text)
                            
                            block_text = " ".join(line_texts).strip()
                            if not block_text:
                                continue
                            
                            # Clean translation branding in source text
                            import re
                            block_text_clean = re.sub(r'(?i)(machine\s+)?translated\s+by\s+google', 'Translated by Tamon', block_text)
                            block_text_clean = re.sub(r'(?i)traducido\s+por\s+google', 'Translated by Tamon', block_text_clean)
                            
                            translated_text = traducir_texto_py(block_text_clean, sl, tl)
                            
                            # Clean translation branding in translated text
                            translated_text = re.sub(r'(?i)(machine\s+)?translated\s+by\s+google', 'Translated by Tamon', translated_text)
                            translated_text = re.sub(r'(?i)traducido\s+por\s+google', 'Translated by Tamon', translated_text)
                            
                            # Compute union rect for the block
                            block_rect = fitz.Rect()
                            word_heights = []
                            for l_num in blocks[b_num]:
                                for w in blocks[b_num][l_num]:
                                    block_rect.include_rect(w["rect"])
                                    word_heights.append(w["font_size"])
                            
                            avg_height = sum(word_heights) / len(word_heights) if word_heights else 10
                            font_size = max(min(avg_height, 24), 6)
                            
                            ratio = len(translated_text) / max(len(block_text_clean), 1)
                            adjusted_font_size = font_size
                            if ratio > 1.0:
                                adjusted_font_size = max(font_size / (ratio ** 0.5), 5.5)
                            
                            page_translations.append({
                                "rect": block_rect,
                                "translated_text": translated_text,
                                "font_size": adjusted_font_size,
                                "text_color": (0, 0, 0)
                            })
                            
                            # Redact each line individually within this block
                            for l_num in blocks[b_num]:
                                line_rect = fitz.Rect()
                                for w in blocks[b_num][l_num]:
                                    line_rect.include_rect(w["rect"])
                                
                                # Add a tiny padding to the redact rect
                                line_rect.x0 = max(0, line_rect.x0 - 1.5)
                                line_rect.y0 = max(0, line_rect.y0 - 1.5)
                                line_rect.x1 = min(page.rect.width, line_rect.x1 + 1.5)
                                line_rect.y1 = min(page.rect.height, line_rect.y1 + 1.5)
                                
                                annot = page.add_redact_annot(line_rect)
                                annot.set_colors(stroke=None, fill=(1, 1, 1))
                    except Exception as e:
                        print(f"Error executing OCR fallback on page {page_num}: {e}")
                        use_ocr = False  # fallback to normal if OCR fails completely
                        
                if not use_ocr:
                    page_dict = page.get_text("dict")
                    for block in page_dict.get("blocks", []):
                        if block.get("type") == 0:  # text block
                            bbox = block.get("bbox")
                            rect = fitz.Rect(bbox[0], bbox[1], bbox[2], bbox[3])
                            
                            spans_info = []
                            block_text = ""
                            for line in block.get("lines", []):
                                for span in line.get("spans", []):
                                    spans_info.append(span)
                                    block_text += span.get("text", "") + " "
                            
                            block_text = block_text.strip()
                            if block_text:
                                if spans_info:
                                    font_sizes = [s.get("size", 9) for s in spans_info]
                                    avg_font_size = sum(font_sizes) / len(font_sizes)
                                    font_size = max(min(avg_font_size, 24), 6)
                                    
                                    colors = [s.get("color", 0) for s in spans_info]
                                    color_int = max(set(colors), key=colors.count)
                                    
                                    r = ((color_int >> 16) & 255) / 255.0
                                    g = ((color_int >> 8) & 255) / 255.0
                                    b = (color_int & 255) / 255.0
                                    text_color = (r, g, b)
                                else:
                                    font_size = 9
                                    text_color = (0, 0, 0)
                                    
                                # Clean translation branding
                                import re
                                block_text_clean = re.sub(r'(?i)(machine\s+)?translated\s+by\s+google', 'Translated by Tamon', block_text)
                                block_text_clean = re.sub(r'(?i)traducido\s+por\s+google', 'Translated by Tamon', block_text_clean)
                                
                                translated_text = traducir_texto_py(block_text_clean, sl, tl)
                                translated_text = re.sub(r'(?i)(machine\s+)?translated\s+by\s+google', 'Translated by Tamon', translated_text)
                                translated_text = re.sub(r'(?i)traducido\s+por\s+google', 'Translated by Tamon', translated_text)
                                
                                # Ajustar tamaño de fuente dinámicamente si la traducción es más larga
                                ratio = len(translated_text) / max(len(block_text_clean), 1)
                                adjusted_font_size = font_size
                                if ratio > 1.0:
                                    adjusted_font_size = max(font_size / (ratio ** 0.5), 5.5)
                                
                                page_translations.append({
                                    "rect": rect,
                                    "translated_text": translated_text,
                                    "font_size": adjusted_font_size,
                                    "text_color": text_color
                                })
                                
                                # Redactar cada línea individualmente dentro de este bloque
                                for line in block.get("lines", []):
                                    line_bbox = line.get("bbox")
                                    line_rect = fitz.Rect(line_bbox[0], line_bbox[1], line_bbox[2], line_bbox[3])
                                    
                                    # Add a tiny padding to the redact rect
                                    line_rect.x0 = max(0, line_rect.x0 - 1.5)
                                    line_rect.y0 = max(0, line_rect.y0 - 1.5)
                                    line_rect.x1 = min(page.rect.width, line_rect.x1 + 1.5)
                                    line_rect.y1 = min(page.rect.height, line_rect.y1 + 1.5)
                                    
                                    annot = page.add_redact_annot(line_rect)
                                    annot.set_colors(stroke=None, fill=(1, 1, 1))
                                    
                page.apply_redactions(images=fitz.PDF_REDACT_IMAGE_NONE)
                
                for item in page_translations:
                    page.insert_textbox(
                        item["rect"],
                        item["translated_text"],
                        fontsize=item["font_size"],
                        fontname="helv",
                        color=item["text_color"]
                    )
                            
            doc.save(output_path)
            doc.close()
            
            import io
            with open(output_path, "rb") as f:
                pdf_bytes = f.read()
                
            return send_file(
                io.BytesIO(pdf_bytes),
                mimetype="application/pdf",
                as_attachment=True,
                download_name="output.pdf"
            )
    except Exception as e:
        import traceback
        print("Error in procesar-pdf-formato:", e)
        traceback.print_exc()
        return jsonify({"error": str(e), "traceback": traceback.format_exc()}), 500

# --- MAIN: Ejecutar en puerto 5002 si es script principal ---
if __name__ == "__main__":
    app.run(port=5002, debug=True, use_reloader=False)
    