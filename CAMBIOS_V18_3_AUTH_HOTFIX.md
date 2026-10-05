# Bot Documental V18.3 — Hotfix de autenticación / streaming

Fecha: 2026-10-05.

## Motivo
Gemini comenzó a devolver `Multiple authentication credentials received. Please pass only one.` al recuperar algunas ejecuciones en segundo plano con `GET /v1beta/interactions/{id}`, incluso cuando el cliente enviaba únicamente `x-goog-api-key`.

## Cambio aplicado
- Se eliminó el flujo normal `background:true` + polling `GET /interactions/{id}`.
- El video se procesa con una sola interacción de Gemini usando `stream:true` (SSE).
- Se mantiene una sola solicitud de modelo para video + guía + borrador.
- La carga inicial de Files API usa exclusivamente `x-goog-api-key`; ya no usa `?key=`.
- No se envía `Authorization: Bearer` a Gemini. El único Bearer que queda en el proyecto corresponde a Google Drive OAuth y no se reenvía a Gemini.
- Se conserva la salida de V18.2: acciones ACC, rango temporal y `capture_timestamp` para que la captura se haga manualmente en el minuto/segundo exacto; no se extraen imágenes.

## Despliegue
Debes publicar nuevamente los archivos de GitHub Pages y volver a desplegar `worker/worker.js` en Cloudflare. No cambies `GEMINI_API_KEY`, `APP_TOKEN`, Google OAuth ni la URL del Worker.

## Pruebas
- 13/13 pruebas Node correctas.
- Smoke test del frontend correcto.
- Contrato de Worker comprueba una sola credencial Gemini y ausencia de polling de Interactions.
