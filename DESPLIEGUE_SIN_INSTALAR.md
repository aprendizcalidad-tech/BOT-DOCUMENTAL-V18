# Despliegue V18 Cloud sin instalar nada

## A. Crear la API key de Gemini

1. Entra a Google AI Studio: https://aistudio.google.com/
2. Crea o selecciona un proyecto.
3. Crea una API key para Gemini.
4. **No pongas esa clave en `config.js`, GitHub ni el navegador.** La clave se guardará como secreto en Cloudflare.

Modelo recomendado inicialmente: `gemini-3.7-flash`.

## B. Crear el backend gratis en Cloudflare Worker

Todo se puede hacer desde el panel web.

1. Entra a https://dash.cloudflare.com/
2. Abre **Workers & Pages**.
3. Crea un Worker nuevo.
4. Abre el editor de código del Worker.
5. Copia TODO el contenido de `worker/worker.js` y reemplaza el código de ejemplo.
6. Guarda y despliega.
7. Ve a **Settings > Variables and Secrets** del Worker.
8. Crea un secreto llamado:

   `GEMINI_API_KEY`

   y pega la API key de Google AI Studio.

9. Recomendado: crea otro secreto llamado:

   `APP_TOKEN`

   Usa una contraseña larga y aleatoria. Este token evita que cualquiera que conozca la URL del Worker pueda consumir tu cuota.

10. Crea una variable normal llamada:

    `ALLOWED_ORIGINS`

    Cuando ya conozcas la URL de GitHub Pages, usa por ejemplo:

    `https://TU-USUARIO.github.io`

    Si el sitio está en una URL de proyecto, el origen sigue siendo `https://TU-USUARIO.github.io`.

11. Vuelve a desplegar si Cloudflare lo solicita.
12. Copia la URL final del Worker, por ejemplo:

    `https://bot-documental-v18.tu-cuenta.workers.dev`

### Prueba rápida del Worker

Abre en el navegador:

`https://TU-WORKER.workers.dev/health`

Debe responder un JSON indicando que el servicio está activo. La página del bot hace esta prueba desde el botón **Comprobar backend**.

## C. Publicar el frontend en GitHub Pages

1. Crea un repositorio en GitHub, por ejemplo `BOT-DOCUMENTAL-V18`.
2. Sube el contenido de la carpeta `BOT_DOCUMENTAL_V18_CLOUD` al repositorio.
3. Puedes excluir la carpeta `worker/` del sitio si quieres; no afecta al frontend. Es útil conservarla en el repositorio como copia del backend.
4. En GitHub abre **Settings > Pages**.
5. Selecciona **Deploy from a branch**.
6. Rama: `main`.
7. Carpeta: `/ (root)`.
8. Guarda y abre la URL que GitHub te entregue.

No necesitas Git instalado para hacer esto; GitHub permite subir el ZIP/archivos desde la interfaz web.

## D. Configurar el bot publicado

En la página de GitHub Pages:

1. Pulsa **Configuración**.
2. En **URL del backend Cloudflare Worker**, pega la URL del Worker.
3. En **Token de la aplicación**, pega el valor de `APP_TOKEN` si lo configuraste.
4. Deja inicialmente:
   - Modelo general: `gemini-3.7-flash`
   - Modelo para video: `gemini-3.7-flash`
5. Guarda.
6. Pulsa **Comprobar backend**.

La API key de Gemini nunca debe aparecer en esa ventana.

## E. Configurar Google Drive (opcional)

Solo hace falta si quieres pegar URLs/IDs de archivos privados de Drive.

1. Entra a Google Cloud Console: https://console.cloud.google.com/
2. Selecciona el mismo proyecto o crea uno.
3. Habilita **Google Drive API**.
4. Configura la pantalla de consentimiento OAuth.
5. Crea credenciales **OAuth Client ID > Web application**.
6. En **Authorized JavaScript origins**, agrega el origen de tu GitHub Pages, por ejemplo:

   `https://TU-USUARIO.github.io`

7. Copia el Client ID que termina en `.apps.googleusercontent.com`.
8. En la página del bot, abre **Configuración** y pégalo en **Google OAuth Client ID**.
9. Guarda y usa **Conectar Drive**.

El token de Drive se conserva solo durante la sesión del navegador.

## F. Cómo procesa videos

### 1. Archivo elegido desde el navegador — hasta 2 GB

- El navegador lee bloques de 16 MB.
- Cada bloque pasa por el Worker.
- El Worker lo reenvía a la carga reanudable de Gemini Files.
- El bot no crea una copia en `data/` ni en otra carpeta local.
- Una vez activo el archivo, Gemini ejecuta análisis de video en modo `agentic`.

### 2. Google Drive — hasta 2 GB

- El navegador solicita rangos del archivo a Drive usando OAuth.
- Cada rango se transmite al Worker y luego a Gemini.
- No se descarga primero el video completo ni se guarda una copia local.

### 3. YouTube público — recomendado para videos muy largos o >2 GB

- Pega el enlace en la pestaña **YouTube**.
- El archivo no pasa por GitHub ni Cloudflare.
- Gemini consume directamente la URL pública y analiza la línea de tiempo.

Esta es la ruta gratuita más práctica para un video, por ejemplo, de varias horas o de 10 GB. El límite deja de ser el tamaño del archivo de Gemini Files, pero siguen aplicando las cuotas de video/uso del proyecto de Gemini.

## G. Por qué no usamos Google Apps Script para mover el video

Apps Script sirve muy bien para automatizaciones pequeñas, pero no es apropiado como túnel de video largo: sus ejecuciones y `UrlFetch` tienen límites que harían frágil una carga de cientos de MB o varios GB. En V18 se usa Cloudflare Worker únicamente como proxy liviano y Gemini hace el procesamiento pesado.

## H. Seguridad

- `GEMINI_API_KEY`: solo en Secret del Worker.
- `APP_TOKEN`: solo en Secret del Worker; en el navegador se guarda en `sessionStorage` y desaparece al cerrar la sesión/pestaña.
- `ALLOWED_ORIGINS`: restringe el Worker a tu GitHub Pages.
- OAuth de Drive: permiso `drive.readonly`; el bot no modifica Drive.
- Nunca publiques una API key dentro de `config.js`.

## I. Si aparece 429 RESOURCE_EXHAUSTED

V18 ya minimiza llamadas, pero el nivel gratuito tiene límites por proyecto/modelo.

1. Revisa los límites activos en Google AI Studio.
2. Espera a que se libere la ventana de cuota.
3. No pulses varias veces **Analizar** en paralelo.
4. Conserva `gemini-3.7-flash` o cambia a otro modelo Flash disponible en tu proyecto.
5. Para videos, el trabajo se inicia una vez y se consulta por estado; las consultas de estado no vuelven a enviar el video al modelo.

## J. Prueba de aceptación

Antes de usar un video de varias horas:

1. Prueba un TXT pequeño.
2. Prueba un video de 1–3 minutos.
3. Prueba un archivo de Drive.
4. Prueba una URL pública de YouTube.
5. Verifica que el Word conserve todas las acciones `ACC-xxxxx`.
6. Después prueba el video largo.
