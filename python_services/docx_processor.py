from docx import Document
from flask import Flask, request, send_file
import tempfile
import os

app = Flask(__name__)


# Nuevo: reemplazo por índice de párrafo y run
def procesar_docx_por_indices(input_path, output_path, traducciones):
    doc = Document(input_path)
    for item in traducciones:
        p_idx = item['paragraph']
        r_idx = item['run']
        texto = item['texto']
        try:
            doc.paragraphs[p_idx].runs[r_idx].text = texto
        except Exception as e:
            print(f"No se pudo reemplazar párrafo {p_idx}, run {r_idx}: {e}")
    doc.save(output_path)


# Nuevo endpoint: recibe JSON con traducciones por índice
@app.route('/procesar-docx', methods=['POST'])
def procesar():
    file = request.files['file']
    traducciones_json = request.form.get('traducciones')
    with tempfile.TemporaryDirectory() as tmpdir:
        input_path = os.path.join(tmpdir, 'input.docx')
        output_path = os.path.join(tmpdir, 'output.docx')
        file.save(input_path)
        if traducciones_json:
            import json
            traducciones = json.loads(traducciones_json)
            procesar_docx_por_indices(input_path, output_path, traducciones)
        else:
            # Modo compatibilidad: reemplazo simple
            from copy import deepcopy
            def identidad(x): return x
            procesar_docx_por_indices(input_path, output_path, [])
        return send_file(output_path, as_attachment=True, download_name='procesado.docx')

if __name__ == '__main__':
    app.run(port=5001)