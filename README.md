# TranslateTAMON - MVP Opción 2

MVP para traducir documentos de entrada **PDF / DOCX / JPG / PNG** con:

- **Vista previa de traducción** para revisión/corrección.
- Salida final en **DOCX** ordenado.
- **Aprendizaje controlado por admin** (no por usuarios finales) sobre correcciones.

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
4. Configura `ADMIN_TOKEN` para acciones de administración.

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

### `POST /api/translate/preview`

`multipart/form-data`:

- `document` (archivo: pdf/docx/jpg/jpeg/png)
- `sourceLanguage`
- `targetLanguage`
- `project` (opcional)
- `domain` (opcional)

Respuesta:

- JSON con `previewId`, `originalText`, `translatedText`.

### `POST /api/translate/finalize`

`application/json`:

- `previewId` (opcional, si vienes de preview)
- `translatedText` (opcional si usas `previewId`; útil cuando el usuario corrigió texto)
- `sourceLanguage`, `targetLanguage`, `originalFileName` (obligatorios si no hay `previewId`)

Respuesta:

- Archivo `*.docx` final con traducción/corrección aprobada.

## Memoria controlada (MongoDB)

Se implementan colecciones para evolucionar a hiperautomatización:

- `TranslationHistory`: historial de traducciones
- `GlossaryEntry`: glosario por proyecto e idiomas
- `UserCorrection`: correcciones del usuario
- `DomainRule`: reglas por dominio (pre/post traducción)

### Endpoints de memoria

- `GET/POST /api/memory/glossary`
- `GET/POST /api/memory/corrections`
- `POST /api/memory/corrections/suggestions` (usuario propone corrección pendiente)
- `POST /api/memory/corrections/suggestions/:id/approve` (solo admin aprueba y entrena memoria)
- `GET/POST /api/memory/rules`

> Si `MONGO_URI` no está configurado, la app funciona sin persistencia y los endpoints de memoria devuelven 503.
>
> `POST /api/memory/corrections` y aprobación de sugerencias requieren header `x-admin-token` con `ADMIN_TOKEN`.

## Scripts

```bash
npm run lint
npm run test
npm run build
```

## Nota sobre PDF escaneado

Este MVP extrae texto de PDF textual. Para PDF escaneado se requiere OCR especializado de PDF (siguiente iteración).
