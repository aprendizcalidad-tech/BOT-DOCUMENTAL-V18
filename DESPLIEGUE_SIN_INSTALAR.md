# DESPLIEGUE V19.1 SIN INSTALAR NADA EN EL PC

Todo se hace desde el navegador.

## A. Crear Backblaze B2

1. Crea tu cuenta en Backblaze.
2. Entra a **B2 Cloud Storage**.
3. Crea un bucket privado, por ejemplo:
   `bot-documental-v19-videos`
4. Copia el **Bucket ID** y el **Bucket Name**.
5. Ve a **Application Keys**.
6. Crea una nueva Application Key limitada al bucket anterior.
7. Dale permisos de lectura y escritura. El Bot necesita subir, descargar para Deepgram y eliminar el archivo al finalizar.
8. Copia inmediatamente:
   - `keyID`
   - `applicationKey`

No necesitas configurar CORS en Backblaze para esta versión porque el navegador no habla directamente con B2: la transferencia pasa por tu Cloudflare Worker.

## B. Deepgram

1. Crea una cuenta.
2. Genera una API Key.
3. Guárdala para el Worker.

## C. Groq

1. Crea una cuenta en GroqCloud.
2. Genera una API Key.
3. Guárdala para el Worker.

## D. Cloudflare Worker

1. Usa tu Worker actual o crea uno gratuito.
2. Copia el contenido de `worker/worker.js` y despliega.
3. NO crees un bucket R2 y NO agregues `VIDEO_BUCKET`.
4. En **Settings → Variables and Secrets** agrega:

### Secrets
- `GROQ_API_KEY`
- `DEEPGRAM_API_KEY`
- `B2_APPLICATION_KEY_ID`
- `B2_APPLICATION_KEY`
- `MEDIA_SIGNING_SECRET`
- `APP_TOKEN`

### Variables
- `B2_BUCKET_ID` = ID del bucket Backblaze.
- `B2_BUCKET_NAME` = nombre del bucket Backblaze.
- `GROQ_MODEL` = `openai/gpt-oss-120b`
- `GROQ_FALLBACK_MODEL` = `openai/gpt-oss-20b`
- `DEEPGRAM_MODEL` = `nova-3`
- `ALLOWED_ORIGINS` = `https://TU-USUARIO.github.io` o la URL exacta de tu Pages.

`MEDIA_SIGNING_SECRET` puede ser una cadena larga aleatoria inventada por ti.
`APP_TOKEN` es otra contraseña larga que luego pondrás en la configuración del frontend.

5. Despliega y copia la URL del Worker, por ejemplo `https://....workers.dev`.

## E. GitHub Pages

1. Sube los archivos del proyecto al repositorio.
2. No subas ninguna API key.
3. Abre GitHub Pages.
4. En Configuración del Bot pega:
   - URL del Worker.
   - `APP_TOKEN` si lo configuraste.
5. Pulsa **Comprobar backend**.

Debe verse aproximadamente:

`Backend: OK · Groq: OK · Deepgram: OK · Backblaze B2: OK`

## Seguridad

- Las claves de Backblaze, Deepgram y Groq solo viven en Cloudflare Worker Secrets.
- GitHub Pages nunca recibe esas claves.
- El bucket debe mantenerse privado.
- Deepgram recibe una URL temporal firmada del Worker, no tus credenciales de Backblaze.
- El video se elimina al finalizar correctamente el análisis.

## Si falla la eliminación

Si una ejecución se interrumpe después de subir el archivo, puede quedar un video temporal en el bucket. Puedes borrarlo manualmente desde Backblaze. Los objetos creados por el Bot están bajo el prefijo `videos/`.
