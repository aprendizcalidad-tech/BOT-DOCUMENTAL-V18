# Bot Documental V18.2 — Cuota optimizada

## Objetivo
Reducir al mínimo las solicitudes de inferencia a Gemini cuando el origen es un video.

## Flujo de video
1. El navegador lee las guías localmente.
2. El video se carga una sola vez a Gemini Files API (si no es YouTube).
3. Se crea **una sola interacción Gemini** con video + contexto de guías.
4. Esa interacción devuelve:
   - inventario exhaustivo de acciones;
   - timestamps de inicio/fin;
   - minuto/segundo recomendado para captura manual;
   - selección de guía;
   - análisis de secciones y brechas;
   - borrador base completo.
5. El navegador reutiliza el borrador; no llama otra vez a Gemini para “Generar borrador”.
6. Las respuestas del usuario a datos faltantes se incorporan localmente y quedan editables.
7. La auditoría final de video es local y determinista: estructura, preguntas requeridas, ACC y timestamps.
8. Word y PDF se generan localmente.

## Solicitudes de modelo
Flujo normal con video: **1 solicitud de inferencia** por trabajo.

No cuentan como una nueva generación de modelo las operaciones de carga Files API ni las consultas de estado del archivo/interacción. `Regenerar sección` es opcional y sí consume una solicitud adicional porque invoca Gemini explícitamente.

## Cuota 429
Si Gemini responde que se agotó la cuota diaria/RPD, el cliente detiene los reintentos automáticos y muestra el mensaje recibido. La V18.2 reduce consumo futuro, pero no puede restablecer una cuota que ya fue agotada.

## Despliegue
Debes actualizar tanto GitHub Pages como Cloudflare Worker:
- publica todos los archivos del frontend;
- vuelve a desplegar `worker/worker.js`;
- conserva tus secretos `GEMINI_API_KEY` y `APP_TOKEN`;
- no necesitas cambiar OAuth de Drive.
