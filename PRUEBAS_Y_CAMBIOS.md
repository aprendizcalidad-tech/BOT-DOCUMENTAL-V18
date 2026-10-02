# V18 Cloud — cambios principales

## Cambio de arquitectura

V17 dependía de un servidor local (`localhost:8765`) con Python, FFmpeg, Faster-Whisper y Ollama. V18 elimina esa dependencia.

V18 usa:

- GitHub Pages: frontend estático.
- Cloudflare Worker: proxy seguro y CORS.
- Gemini API: IA de texto y comprensión de video.
- Gemini Files: carga temporal de videos de hasta 2 GB en nivel gratuito.
- Gemini Interactions API: análisis de videos largos en segundo plano con procesamiento `agentic`.
- Google Drive OAuth: lectura opcional de documentos/videos.
- YouTube público: ruta para videos muy largos o mayores de 2 GB.

## Cambios para reducir 429

- Análisis de estructura: 1 llamada principal.
- Borrador completo: 1 llamada principal, no una llamada por sección.
- Auditoría completa: 1 llamada principal, no una llamada por sección.
- Regeneración: solo consume una llamada cuando el usuario pide regenerar una sección.
- Video: una interacción en segundo plano; el frontend solo consulta su estado.

## Pruebas automáticas ejecutadas

`npm test`

La suite valida:

- cliente cloud y token del backend;
- error del Worker sin convertirlo en documento;
- conservación de 500 acciones ACC;
- detección de una acción eliminada accidentalmente;
- generación real de DOCX y PDF;
- trazabilidad de evidencia por ID.

## Limitación conocida y explícita

No existe una ruta documentada del nivel gratuito de Gemini Files para subir un archivo privado individual de 10 GB: el límite gratuito por archivo es 2 GB. Para esos casos V18 usa YouTube público. Si el video no puede hacerse público y supera 2 GB, haría falta cambiar de estrategia o usar un nivel/servicio con límites mayores.
