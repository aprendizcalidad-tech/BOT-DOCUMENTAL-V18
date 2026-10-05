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

## Cambio V18.1 — capturas manuales por timestamp

Esta variante ya **no extrae ni incrusta capturas del video**. Durante el análisis de video, Gemini devuelve para cada acción:

- intervalo real de la acción (`timestamp_start` / `timestamp_end`),
- `capture_timestamp`: minuto/segundo exacto recomendado para abrir el video,
- `capture_seconds`: la misma referencia en segundos,
- `capture_recommended`: indica si vale la pena tomar una captura,
- `capture_reason`: qué debería verse en ese instante.

En el borrador y en el Word/PDF cada paso queda, por ejemplo:

`[ACC-00012] Selecciona Guardar · Video: 00:18:39–00:18:45 · Captura sugerida: 00:18:42`

Así solo tienes que ir al minuto indicado, tomar la captura manualmente y pegarla donde corresponda si la necesitas.

## V18.2 — ahorro de cuota de Gemini

Para un origen de video, el flujo normal ahora es:

1. Subir el video a Files API (carga de archivo).
2. Ejecutar una sola interacción Gemini que devuelve acciones + timestamps + selección de guía + análisis + borrador.
3. Editar en el navegador.
4. Validar cobertura y estructura localmente.
5. Generar Word/PDF localmente.

No pulses **Regenerar sección** salvo que realmente lo necesites: esa acción sí crea una solicitud adicional de Gemini.
