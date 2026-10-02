const GEMINI_BASE = 'https://generativelanguage.googleapis.com';
const API_REVISION = '2026-05-20';

function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
}

function corsHeaders(origin, env) {
  const list = allowedOrigins(env);
  const allowed = list.includes('*') || !origin || list.includes(origin);
  if (!allowed) return null;
  return {
    'Access-Control-Allow-Origin': origin || (list.includes('*') ? '*' : (list[0] || '*')),
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-App-Token,X-Upload-URL,X-Upload-Offset,X-Upload-Final',
    'Access-Control-Max-Age': '86400'
  };
}

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {'Content-Type':'application/json; charset=utf-8', ...(cors || {})}
  });
}

async function upstreamJson(response) {
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; }
  catch { body = {raw:text}; }
  if (!response.ok) {
    const message = body?.error?.message || body?.error || body?.message || text || `Gemini ${response.status}`;
    const error = new Error(String(message));
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function authOk(request, env) {
  if (!env.APP_TOKEN) return true;
  return request.headers.get('X-App-Token') === env.APP_TOKEN;
}

function apiHeaders(env, extra = {}) {
  if (!env.GEMINI_API_KEY) throw new Error('Falta el secreto GEMINI_API_KEY en el Worker.');
  return {'x-goog-api-key': env.GEMINI_API_KEY, ...extra};
}

async function readJson(request) {
  const size = Number(request.headers.get('content-length') || 0);
  if (size > 6 * 1024 * 1024) throw Object.assign(new Error('Solicitud JSON demasiado grande.'), {status:413});
  return await request.json();
}

function validateModel(model) {
  model = String(model || '').trim();
  if (!/^gemini-[a-z0-9._-]+$/i.test(model)) throw Object.assign(new Error('Modelo Gemini inválido.'), {status:400});
  return model;
}

async function handleChat(request, env) {
  const body = await readJson(request);
  const model = validateModel(body.model || 'gemini-3.7-flash');
  const prompt = String(body.prompt || '');
  if (!prompt.trim()) throw Object.assign(new Error('Prompt vacío.'), {status:400});
  const images = Array.isArray(body.images) ? body.images.slice(0, 8) : [];
  const parts = [{text:prompt}];
  for (const image of images) {
    if (typeof image === 'string' && image.length) parts.push({inline_data:{mime_type:'image/jpeg',data:image}});
  }
  const generationConfig = {
    temperature: 0,
    maxOutputTokens: Math.min(Math.max(Number(body.maxTokens) || 8192, 512), 65536),
    responseMimeType: 'application/json'
  };
  if (body.schema && typeof body.schema === 'object') generationConfig.responseSchema = body.schema;
  const response = await fetch(`${GEMINI_BASE}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method:'POST',
    headers:apiHeaders(env, {'Content-Type':'application/json'}),
    body:JSON.stringify({contents:[{role:'user',parts}], generationConfig})
  });
  const data = await upstreamJson(response);
  const text = (data.candidates || []).flatMap(c => c?.content?.parts || []).map(p => p?.text || '').join('').trim();
  if (!text) throw Object.assign(new Error(data?.promptFeedback?.blockReason ? `Gemini bloqueó la respuesta: ${data.promptFeedback.blockReason}` : 'Gemini devolvió una respuesta vacía.'), {status:502});
  try { return JSON.parse(text); }
  catch {
    const cleaned = text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
    try { return JSON.parse(cleaned); }
    catch { throw Object.assign(new Error('Gemini no devolvió JSON válido.'), {status:502}); }
  }
}

async function handleFileStart(request, env) {
  const body = await readJson(request);
  const name = String(body.name || 'video').slice(0, 180);
  const mimeType = String(body.mimeType || 'video/mp4').slice(0, 120);
  const size = Number(body.size || 0);
  if (!Number.isFinite(size) || size <= 0) throw Object.assign(new Error('Tamaño de archivo inválido.'), {status:400});
  if (size > 2 * 1024 * 1024 * 1024) throw Object.assign(new Error('Gemini Files gratuito admite hasta 2 GB por archivo. Para videos mayores usa una URL pública de YouTube.'), {status:413});
  const response = await fetch(`${GEMINI_BASE}/upload/v1beta/files?key=${encodeURIComponent(env.GEMINI_API_KEY)}`, {
    method:'POST',
    headers:{
      'X-Goog-Upload-Protocol':'resumable',
      'X-Goog-Upload-Command':'start',
      'X-Goog-Upload-Header-Content-Length':String(size),
      'X-Goog-Upload-Header-Content-Type':mimeType,
      'Content-Type':'application/json'
    },
    body:JSON.stringify({file:{display_name:name}})
  });
  if (!response.ok) await upstreamJson(response);
  const uploadUrl = response.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw Object.assign(new Error('Google no devolvió la sesión de carga reanudable.'), {status:502});
  return {ok:true, uploadUrl, name, mimeType, size};
}

async function handleFileChunk(request) {
  const uploadUrl = request.headers.get('X-Upload-URL') || '';
  if (!/^https:\/\/.*googleapis\.com\//i.test(uploadUrl)) throw Object.assign(new Error('Sesión de carga inválida.'), {status:400});
  const offset = Number(request.headers.get('X-Upload-Offset') || 0);
  const final = request.headers.get('X-Upload-Final') === '1';
  if (!Number.isSafeInteger(offset) || offset < 0) throw Object.assign(new Error('Offset de carga inválido.'), {status:400});
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) throw Object.assign(new Error('No se pudo determinar el tamaño del bloque.'), {status:411});
  if (contentLength > 64 * 1024 * 1024) throw Object.assign(new Error('Bloque demasiado grande; usa 16 MB.'), {status:413});
  // Transmitimos el stream directamente a Gemini: el Worker no guarda el bloque en memoria ni en disco.
  const response = await fetch(uploadUrl, {
    method:'POST',
    headers:{
      'Content-Length':String(contentLength),
      'X-Goog-Upload-Offset':String(offset),
      'X-Goog-Upload-Command': final ? 'upload, finalize' : 'upload'
    },
    body:request.body
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text;
    try { message = JSON.parse(text)?.error?.message || text; } catch {}
    throw Object.assign(new Error(message || `Carga Gemini ${response.status}`), {status:response.status});
  }
  if (!final) return {ok:true, offset: offset + contentLength};
  let data;
  try { data = JSON.parse(text); } catch { throw Object.assign(new Error('Respuesta final de Files API inválida.'), {status:502}); }
  return {ok:true, ...data};
}

async function handleFileQuery(request) {
  const uploadUrl = request.headers.get('X-Upload-URL') || '';
  if (!/^https:\/\/.*googleapis\.com\//i.test(uploadUrl)) throw Object.assign(new Error('Sesión de carga inválida.'), {status:400});
  const response = await fetch(uploadUrl, {
    method:'POST',
    headers:{'Content-Length':'0','X-Goog-Upload-Command':'query'}
  });
  if (!response.ok) {
    const text = await response.text();
    let message = text;
    try { message = JSON.parse(text)?.error?.message || text; } catch {}
    throw Object.assign(new Error(message || `Consulta de carga Gemini ${response.status}`), {status:response.status});
  }
  const received = Number(response.headers.get('x-goog-upload-size-received') || 0);
  const status = String(response.headers.get('x-goog-upload-status') || 'active').toLowerCase();
  return {ok:true, offset:Number.isSafeInteger(received) ? received : 0, status};
}

async function handleFileStatus(url, env) {
  const name = url.searchParams.get('name') || '';
  if (!/^files\/[A-Za-z0-9._-]+$/.test(name)) throw Object.assign(new Error('Nombre de archivo Gemini inválido.'), {status:400});
  const response = await fetch(`${GEMINI_BASE}/v1beta/${name}`, {headers:apiHeaders(env)});
  return await upstreamJson(response);
}

const VIDEO_SCHEMA = {
  type:'object',
  properties:{
    duration_seconds:{type:'number'},
    duration_estimate:{type:'string'},
    detected_language:{type:'string'},
    full_transcript:{type:'string'},
    transcript_segments:{type:'array',items:{type:'object',properties:{start:{type:'string'},end:{type:'string'},text:{type:'string'}},required:['start','end','text']}},
    actions:{type:'array',items:{type:'object',properties:{action:{type:'string'},timestamp_start:{type:'string'},timestamp_end:{type:'string'},start_seconds:{type:'number'},end_seconds:{type:'number'},system:{type:'string'},interface_element:{type:'string'},result:{type:'string'},uncertainty:{type:'string'}},required:['action','timestamp_start','timestamp_end','start_seconds','end_seconds','system','interface_element','result','uncertainty']}},
    uncertainties:{type:'array',items:{type:'string'}},
    coverage:{type:'object',properties:{complete:{type:'boolean'},duration_seconds:{type:'number'},scope:{type:'string'},last_timestamp:{type:'string'}},required:['complete','duration_seconds','scope','last_timestamp']}
  },
  required:['duration_seconds','duration_estimate','detected_language','full_transcript','actions','uncertainties','coverage']
};

function videoPrompt() {
  return `Analiza TODO el video de principio a fin como fuente para documentación operativa. Usa tanto audio/transcripción como contenido visual. Extrae cronológicamente TODAS las acciones observables que realiza la persona, incluso acciones repetidas cuando cambian datos, pantallas o resultados. Cada acción debe ser independiente y utilizable luego como un paso de procedimiento: verbo de acción, sistema o módulo, ruta/pantalla, botón/campo/elemento, dato introducido o seleccionado cuando sea visible, actor si se identifica, validación y resultado. No inventes clics, nombres de botones, datos, rutas ni resultados que no sean observables. Si algo no es legible o inequívoco, conserva la acción pero registra la incertidumbre. Usa marcas de tiempo precisas MM:SS o HH:MM:SS y segundos numéricos. No omitas partes silenciosas que contengan actividad visual. full_transcript debe ser una narración operativa completa y fiel, no una síntesis de pocas líneas. coverage.complete solo puede ser true si revisaste hasta el final real del video. Devuelve exclusivamente JSON válido conforme al esquema.`;
}

async function handleVideoStart(request, env) {
  const body = await readJson(request);
  const model = validateModel(body.model || 'gemini-3.7-flash');
  const input = [];
  if (body.youtubeUrl) {
    const uri = String(body.youtubeUrl).trim();
    if (!/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(uri)) throw Object.assign(new Error('La URL de YouTube no es válida.'), {status:400});
    input.push({type:'video', uri, processing:'agentic'});
  } else {
    const uri = String(body.uri || '').trim();
    const mimeType = String(body.mimeType || 'video/mp4').trim();
    if (!uri) throw Object.assign(new Error('Falta la URI del video subido a Gemini.'), {status:400});
    input.push({type:'video', uri, mime_type:mimeType, processing:'agentic'});
  }
  input.push({type:'text', text:videoPrompt()});
  const response = await fetch(`${GEMINI_BASE}/v1beta/interactions`, {
    method:'POST',
    headers:apiHeaders(env, {'Content-Type':'application/json','Api-Revision':API_REVISION}),
    body:JSON.stringify({
      model,
      input,
      background:true,
      store:true,
      generation_config:{temperature:0,max_output_tokens:65536},
      response_format:{type:'text',mime_type:'application/json',schema:VIDEO_SCHEMA}
    })
  });
  return await upstreamJson(response);
}

async function handleInteractionResponse(id, env, cors) {
  if (!/^v1_[A-Za-z0-9._-]+$/.test(id)) throw Object.assign(new Error('ID de interacción inválido.'), {status:400});
  const response = await fetch(`${GEMINI_BASE}/v1beta/interactions/${encodeURIComponent(id)}`, {
    headers:apiHeaders(env, {'Api-Revision':API_REVISION})
  });
  // El resultado de un video largo puede ser grande. Lo reenviamos como stream para ahorrar CPU/memoria del plan gratuito.
  const headers = new Headers(cors || {});
  headers.set('Content-Type', response.headers.get('Content-Type') || 'application/json; charset=utf-8');
  return new Response(response.body, {status:response.status, headers});
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    if (!cors) return new Response('Origin not allowed', {status:403});
    if (request.method === 'OPTIONS') return new Response(null, {status:204,headers:cors});
    const url = new URL(request.url);
    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return json({ok:true,service:'bot-documental-v18',geminiConfigured:!!env.GEMINI_API_KEY,tokenRequired:!!env.APP_TOKEN},200,cors);
      }
      if (!authOk(request, env)) return json({ok:false,error:'Token de aplicación inválido.'},401,cors);
      if (url.pathname === '/chat' && request.method === 'POST') return json(await handleChat(request,env),200,cors);
      if (url.pathname === '/files/start' && request.method === 'POST') return json(await handleFileStart(request,env),200,cors);
      if (url.pathname === '/files/chunk' && request.method === 'POST') return json(await handleFileChunk(request),200,cors);
      if (url.pathname === '/files/query' && request.method === 'POST') return json(await handleFileQuery(request),200,cors);
      if (url.pathname === '/files/status' && request.method === 'GET') return json(await handleFileStatus(url,env),200,cors);
      if (url.pathname === '/video/start' && request.method === 'POST') return json(await handleVideoStart(request,env),200,cors);
      const match = url.pathname.match(/^\/interactions\/(v1_[A-Za-z0-9._-]+)$/);
      if (match && request.method === 'GET') return await handleInteractionResponse(match[1],env,cors);
      return json({ok:false,error:'Ruta no encontrada.'},404,cors);
    } catch (error) {
      const status = Number(error?.status) || 500;
      return json({ok:false,error:String(error?.message || error),details:error?.body || undefined},status,cors);
    }
  }
};
