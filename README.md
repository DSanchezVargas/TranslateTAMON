# Tamon's Translator (TranslateTAMON) - MVP Opción 2

MVP para traducir documentos de entrada **PDF / DOCX / JPG / PNG / TXT** con:

- **Vista previa de traducción** para revisión/corrección.
- Salida final en **DOCX** ordenado.
- **Aprendizaje controlado por admin** (no por usuarios finales) sobre correcciones.
- **Frontend web Tamon** para flujo completo: carga → preview → corrección → descarga.
- **ETA, barra de progreso y barra de historial de aprendizaje** para visibilidad de proceso.
- **Pestaña de comentarios de usuario** para mejorar la memoria continuamente.

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
5. Ajusta `MAX_UPLOAD_MB` y `REQUEST_BODY_LIMIT` para manejar documentos grandes.

### Documentos largos (20+ páginas)

- El flujo de traducción no impone límite por cantidad de palabras o caracteres del texto traducido.
- Para archivos grandes, ajusta `MAX_UPLOAD_MB` (subida multipart) y `REQUEST_BODY_LIMIT` (JSON de finalize) según tu infraestructura.

## Ejecutar

```bash
npm install
npm run dev
```

Servidor por defecto: `http://localhost:3000`

Interfaz web: `GET /`

## Ícono del sistema

- Ubicación del archivo: `public/icons/tamon.svg`
- URL pública: `GET /icons/tamon.svg`
- Ruta expuesta en API: `GET /health` campo `systemIconPath`

## Endpoint principal

### `POST /api/translate`

`multipart/form-data`:

- `document` (archivo: pdf/docx/jpg/jpeg/png/txt)
- `sourceLanguage` (ej: `en`)
- `targetLanguage` (ej: `es`)
- `project` (opcional, default: `default`)
- `domain` (opcional, default: `general`)

Respuesta:

- Archivo `*.docx` con traducción.

### `POST /api/translate/preview`

`multipart/form-data`:

- `document` (archivo: pdf/docx/jpg/jpeg/png/txt)
- `sourceLanguage`
- `targetLanguage`
- `project` (opcional)
- `domain` (opcional)

Respuesta:

- JSON con `previewId`, `traceId`, `originalText`, `translatedText` y bloque `experience` (incluye ETA estimada y progreso).

### `POST /api/translate/finalize`

`application/json`:

- `previewId` (opcional, si vienes de preview)
- `translatedText` (opcional si usas `previewId`; útil cuando el usuario corrigió texto)
- `sourceLanguage`, `targetLanguage`, `originalFileName` (obligatorios si no hay `previewId`)

Respuesta:

- Archivo `*.docx` final con traducción/corrección aprobada.
- Incluye headers de trazabilidad: `X-Tamon-Trace-Id`, `X-Tamon-Status`, `X-Tamon-Processing-Ms`.

### `GET /api/assistant/status`

- Estado de producto para frontend/app: branding, flujo hiperautomatizado y estado de aprendizaje (incluye `learningProgressPercent` y operación autónoma sin admin 24/7).

### `POST /api/assistant/translate-text`

`application/json`:

- `text` (obligatorio, texto libre para traducir sin archivo)
- `sourceLanguage` (obligatorio)
- `targetLanguage` (obligatorio)
- `userName` (opcional, default `usuario`)

Respuesta:

- JSON con `translatedText` y `assistantResponse` en tono conversacional (ej: `Bueno <usuario>, tu traducción a <idioma> es: ...`).

## Memoria controlada (MongoDB)

Se implementan colecciones para evolucionar a hiperautomatización:

- `TranslationHistory`: historial de traducciones
- `GlossaryEntry`: glosario por proyecto e idiomas
- `UserCorrection`: correcciones del usuario
- `CorrectionSuggestion`: sugerencias de usuarios para revisión admin
- `DomainRule`: reglas por dominio (pre/post traducción)

Además, la app reutiliza traducciones previas automáticamente (cache por hash de texto + proyecto + idiomas + dominio), incluso cuando el admin no interviene.

### Endpoints de memoria

- `GET /api/memory/glossary`
- `POST /api/memory/glossary` (solo admin)
- `GET/POST /api/memory/corrections`
- `POST /api/memory/corrections/suggestions` (usuario propone corrección pendiente)
- `POST /api/memory/corrections/suggestions/:id/approve` (solo admin aprueba y entrena memoria)
- `GET /api/memory/rules`
- `POST /api/memory/rules` (solo admin)

> Si `MONGO_URI` no está configurado, la app funciona sin persistencia y los endpoints de memoria devuelven 503.
>
> `POST /api/memory/glossary`, `POST /api/memory/corrections`, `POST /api/memory/rules` y la aprobación de sugerencias requieren header `x-admin-token` con `ADMIN_TOKEN`.

## Scripts

```bash
npm run lint
npm run test
npm run build
```

## Nota sobre PDF escaneado

Este MVP extrae texto de PDF textual. Para PDF escaneado se requiere OCR especializado de PDF (siguiente iteración).
