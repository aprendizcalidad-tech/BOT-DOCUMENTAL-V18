# BOT DOCUMENTAL V19.1 — BACKBLAZE B2 + DEEPGRAM + GROQ

## Qué hace esta versión

Esta versión NO usa Gemini y NO usa Cloudflare R2.

Arquitectura:

GitHub Pages → Cloudflare Worker → Backblaze B2 → Deepgram → Groq → Word/PDF en el navegador.

- **Backblaze B2** guarda temporalmente el video.
- **Deepgram Nova-3** transcribe el audio/video completo y conserva timestamps.
- **Groq GPT-OSS** transforma la transcripción en acciones y prepara el borrador según la guía.
- El documento NO inserta imágenes automáticamente. Cada acción conserva el minuto/segundo exacto para que hagas la captura manual.

## Lo que debes crear una sola vez

1. API Key de Deepgram.
2. API Key de Groq.
3. Cuenta Backblaze B2.
4. Bucket privado de Backblaze B2.
5. Application Key de Backblaze limitada a ese bucket.
6. Cloudflare Worker con `worker/worker.js`.
7. GitHub Pages con el frontend.

No necesitas Python, Docker, n8n, FFmpeg, Ollama ni Cloudflare R2.

## Datos que debes copiar de Backblaze

Después de crear el bucket y la Application Key necesitarás:

- `B2_BUCKET_NAME`: nombre del bucket.
- `B2_BUCKET_ID`: ID del bucket.
- `B2_APPLICATION_KEY_ID`: keyID generado por Backblaze.
- `B2_APPLICATION_KEY`: applicationKey. **Backblaze muestra esta clave completa una sola vez; guárdala.**

Para la Application Key usa acceso al bucket del Bot Documental con permisos de lectura y escritura. El Worker necesita subir, leer y eliminar los videos temporales.

## Variables/secrets del Cloudflare Worker

En Worker → Settings → Variables and Secrets agrega como **Secrets**:

- `GROQ_API_KEY`
- `DEEPGRAM_API_KEY`
- `B2_APPLICATION_KEY_ID`
- `B2_APPLICATION_KEY`
- `MEDIA_SIGNING_SECRET`
- `APP_TOKEN` (recomendado)

Agrega como variables normales:

- `B2_BUCKET_ID`
- `B2_BUCKET_NAME`
- `GROQ_MODEL` = `openai/gpt-oss-120b`
- `GROQ_FALLBACK_MODEL` = `openai/gpt-oss-20b`
- `DEEPGRAM_MODEL` = `nova-3`
- `ALLOWED_ORIGINS` = URL exacta de tu GitHub Pages

No debes crear ningún binding R2.

## Flujo de uso

1. Carga una o varias guías PDF/DOCX/TXT.
2. Selecciona un video local o de Google Drive.
3. Pulsa **Analizar guías y origen**.
4. El navegador manda el video al Worker en partes.
5. El Worker almacena esas partes temporalmente en Backblaze B2.
6. Deepgram transcribe el archivo con tiempos.
7. Groq extrae las acciones y prepara el borrador.
8. La aplicación valida las acciones localmente.
9. Descargas Word/PDF.
10. El Worker elimina el video temporal de B2 al terminar correctamente.

Ejemplo:

`[ACC-00012] Selecciona Guardar · Video: 00:18:39–00:18:45 · Captura sugerida: 00:18:42`

## Importante

V19.1 reconstruye las acciones desde la **narración/transcripción**. No analiza automáticamente cada píxel de la pantalla. Si la persona hace clics silenciosos sin explicar lo que hace, esos clics pueden no aparecer.
