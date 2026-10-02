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
