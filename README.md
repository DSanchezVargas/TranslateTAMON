# TranslateTAMON - MVP Opción 2

MVP para traducir documentos de entrada **PDF / DOCX / JPG / PNG** y devolver siempre un archivo **DOCX** ordenado con la traducción.

## Stack

- Node.js + Express
- MongoDB (Compass) con Mongoose
- OCR con Tesseract.js (imágenes)
- Extracción de texto: `pdf-parse` (PDF) y `mammoth` (DOCX)
- Traducción: LibreTranslate API
- Generación de salida DOCX: `docx`

## Requisitos

- Node.js 20+
- MongoDB local o remoto (opcional, recomendado para memoria)

## Configuración

1. Copia variables de entorno:

```bash
cp .env.example .env
```

2. Configura `MONGO_URI` para usar Compass.
3. (Opcional) configura `LIBRETRANSLATE_API_KEY` si tu proveedor lo requiere.

## Ejecutar

```bash
npm install
npm run dev
```

Servidor por defecto: `http://localhost:3000`

## Endpoint principal

### `POST /api/translate`

`multipart/form-data`:

- `document` (archivo: pdf/docx/jpg/jpeg/png)
- `sourceLanguage` (ej: `en`)
- `targetLanguage` (ej: `es`)
- `project` (opcional, default: `default`)
- `domain` (opcional, default: `general`)

Respuesta:

- Archivo `*.docx` con traducción.

## Memoria controlada (MongoDB)

Se implementan colecciones para evolucionar a hiperautomatización:

- `TranslationHistory`: historial de traducciones
- `GlossaryEntry`: glosario por proyecto e idiomas
- `UserCorrection`: correcciones del usuario
- `DomainRule`: reglas por dominio (pre/post traducción)

### Endpoints de memoria

- `GET/POST /api/memory/glossary`
- `GET/POST /api/memory/corrections`
- `GET/POST /api/memory/rules`

> Si `MONGO_URI` no está configurado, la app funciona sin persistencia y los endpoints de memoria devuelven 503.

## Scripts

```bash
npm run lint
npm run test
npm run build
```

## Nota sobre PDF escaneado

Este MVP extrae texto de PDF textual. Para PDF escaneado se requiere OCR especializado de PDF (siguiente iteración).
