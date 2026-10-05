# V18.1 Cloud + Timestamps

Cambios principales:

- Se eliminó la extracción automática de capturas/frames del navegador.
- Se eliminó el selector visual de capturas.
- Cada acción de video conserva su rango temporal.
- Gemini devuelve un instante exacto recomendado para captura manual.
- El paso documentado incluye `Video:` y `Captura sugerida:`.
- El auditor determinista valida cobertura ACC y presencia de referencias temporales.
- Word y PDF ya no incrustan imágenes automáticamente.
- Los proyectos V18 anteriores siguen siendo legibles; si un borrador antiguo no tiene marcas `Captura sugerida`, regenera los pasos del video antes de finalizar.

Pruebas: ejecutar `npm test` desde la carpeta del proyecto.

## V18.2 — modo ahorro de cuota

- El video se sube una sola vez a Gemini Files API y se reutiliza por URI.
- El análisis del video, inventario de acciones, timestamps de captura manual, selección de guía y borrador base se solicitan en **una sola interacción** de Gemini.
- Para videos, `Generar borrador` reutiliza el borrador ya devuelto: no hace otra llamada al modelo.
- Las respuestas a brechas se incorporan localmente al borrador y quedan visibles para edición.
- `Finalizar` usa auditoría determinista local para estructura, datos críticos y trazabilidad ACC/timestamps; no llama a Gemini.
- `Regenerar sección` sigue siendo opcional y sí consume una solicitud de modelo porque el usuario la solicita explícitamente.
- Los errores 429 de cuota diaria no se reintentan automáticamente.
- Este cambio reduce el flujo normal de video de varias inferencias a **1 inferencia por trabajo de video**, sin eludir ni aumentar los límites configurados por Google.
