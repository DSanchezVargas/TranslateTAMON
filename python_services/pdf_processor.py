from flask import Flask, request, send_file, jsonify
import tempfile
import os
import fitz  # PyMuPDF
from PIL import Image, ImageDraw, ImageFont
import pytesseract
import json

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

# --- MAIN: Ejecutar en puerto 5002 si es script principal ---
if __name__ == "__main__":
    app.run(port=5002)