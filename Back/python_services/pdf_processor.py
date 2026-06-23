from flask import Flask, request, send_file, jsonify
import tempfile
import os
import fitz  # PyMuPDF
from PIL import Image, ImageDraw, ImageFont
import pytesseract
import json
import requests
import urllib.parse

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
        return send_file(output_path, as_attachment=True, download_name="output.pdf")

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
            page_dict = page.get_text("dict")
            
            page_translations = []
            
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
                            
                        translated_text = traducir_texto_py(block_text, sl, tl)
                        page_translations.append({
                            "rect": rect,
                            "translated_text": translated_text,
                            "font_size": font_size,
                            "text_color": text_color
                        })
                        
                        annot = page.add_redact_annot(rect)
                        annot.set_colors(stroke=None, fill=None)
                        
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
        return send_file(output_path, as_attachment=True, download_name="output.pdf")

# --- MAIN: Ejecutar en puerto 5002 si es script principal ---
if __name__ == "__main__":
    app.run(port=5002)
    