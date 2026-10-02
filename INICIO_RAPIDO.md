# BOT DOCUMENTAL V18 CLOUD — inicio rápido

Esta versión **no necesita instalar Python, FFmpeg, Whisper, Ollama ni ningún servidor en el computador**.

La arquitectura es:

1. **GitHub Pages** publica la interfaz web.
2. **Cloudflare Worker** actúa como backend seguro y guarda la API key de Gemini como secreto.
3. **Gemini API** analiza documentos y videos.
4. **Google Drive** es opcional y se conecta por OAuth desde el navegador.
5. Los videos de archivo/Drive se envían a Gemini por bloques, sin crear una copia en una carpeta local del PC.
6. Para videos muy grandes se puede usar una **URL pública de YouTube** y Gemini analiza el video directamente.

## Lo único que necesitas

- Una cuenta de GitHub.
- Una cuenta gratuita de Cloudflare.
- Una API key de Gemini creada en Google AI Studio.
- Solo si usarás Drive: un OAuth Client ID de Google para aplicación web.

No necesitas ejecutar ningún `.bat`, `.py`, `npm install` ni terminal para ponerlo en producción. Todo se puede configurar desde navegador.

## Orden recomendado

1. Sigue `DESPLIEGUE_SIN_INSTALAR.md`.
2. Publica el contenido de esta carpeta en GitHub Pages.
3. Abre la página publicada.
4. Pulsa **Configuración**.
5. Pega la URL de tu Cloudflare Worker.
6. Pega el token de aplicación si lo configuraste.
7. Si usarás Drive, pega tu Google OAuth Client ID.
8. Pulsa **Comprobar backend**.

## Límites importantes

- Videos subidos desde el navegador o leídos desde Drive: **hasta 2 GB por archivo en el nivel gratuito de Gemini Files**.
- Videos mayores de 2 GB: usa la pestaña **YouTube** con una URL pública.
- Los videos de YouTube directos deben ser públicos.
- Los archivos temporales subidos a Gemini Files caducan; el bot no los conserva en el PC.
- La cuota exacta de Gemini depende del proyecto y puede producir `429` si se agota. V18 reduce el número de llamadas de IA frente a V17: una llamada para análisis, una para borrador completo y una para auditoría completa, además del análisis de video.

## Qué ya no existe en V18

- `server.py`
- `local_ai.py`
- Ollama
- Faster-Whisper
- FFmpeg local
- carpeta `data/`
- carpeta de modelos locales
- `localhost:8765`

El frontend sigue generando Word y PDF en el navegador.
