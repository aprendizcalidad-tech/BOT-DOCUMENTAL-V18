# Cambios V19.1 — Backblaze B2 + Deepgram + Groq

- Se eliminó Cloudflare R2 y el binding `VIDEO_BUCKET`.
- El almacenamiento temporal ahora usa **Backblaze B2 Native API**.
- El Worker autentica B2 con `B2_APPLICATION_KEY_ID` + `B2_APPLICATION_KEY`.
- Carga de videos grandes por bloques de aproximadamente 32 MB.
- Cada parte se valida con SHA-1 antes de finalizar el archivo B2.
- Deepgram accede al archivo mediante una URL temporal del Worker; el bucket continúa privado.
- Al finalizar correctamente, el Worker elimina la versión temporal de B2.
- Se mantienen Deepgram, Groq, ACC-xxxxx, timestamps y captura sugerida manual.
- No hay Gemini ni extracción automática de imágenes.
