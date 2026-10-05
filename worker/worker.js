const MAX_GUIDES = 8;
const MAX_GUIDE_CONTEXT_CHARS = 320_000;
const MAX_JSON_BYTES = 8 * 1024 * 1024;
const DEFAULT_DOC_MODEL = 'openai/gpt-oss-120b';
const DEFAULT_STT_MODEL = 'nova-3';
const GROQ_BASE = 'https://api.groq.com/openai/v1';
const DEEPGRAM_BASE = 'https://api.deepgram.com/v1/listen';
const MEDIA_TTL_SECONDS = 6 * 60 * 60;

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
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,X-App-Token,X-Upload-Key,X-Upload-Id,X-Part-Number',
    'Access-Control-Max-Age': '86400'
  };
}

function json(data, status = 200, cors = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {'Content-Type': 'application/json; charset=utf-8', ...cors}
  });
}

function authOk(request, env) {
  if (!env.APP_TOKEN) return true;
  return request.headers.get('X-App-Token') === env.APP_TOKEN;
}

async function readJson(request) {
  const size = Number(request.headers.get('content-length') || 0);
  if (size > MAX_JSON_BYTES) throw Object.assign(new Error('Solicitud JSON demasiado grande.'), {status: 413});
  return await request.json();
}

function cleanJsonText(text) {
  return String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

async function upstreamJson(response, provider = 'Servicio externo') {
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : {}; } catch { body = {raw: text}; }
  if (!response.ok) {
    const message = body?.error?.message || body?.err_msg || body?.error || body?.message || text || `${provider} ${response.status}`;
    const error = new Error(String(message));
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function validateGroqModel(model) {
  const value = String(model || DEFAULT_DOC_MODEL).trim();
  if (!/^[a-z0-9._\/-]+$/i.test(value)) throw Object.assign(new Error('Modelo Groq inválido.'), {status: 400});
  return value;
}

function validateSttModel(model) {
  const value = String(model || DEFAULT_STT_MODEL).trim();
  if (!/^[a-z0-9._-]+$/i.test(value)) throw Object.assign(new Error('Modelo Deepgram inválido.'), {status: 400});
  return value;
}

function requireServices(env, {groq = false, deepgram = false, b2 = false} = {}) {
  if (groq && !env.GROQ_API_KEY) throw new Error('Falta el secreto GROQ_API_KEY en el Worker.');
  if (deepgram && !env.DEEPGRAM_API_KEY) throw new Error('Falta el secreto DEEPGRAM_API_KEY en el Worker.');
  if (b2) {
    if (!env.B2_APPLICATION_KEY_ID) throw new Error('Falta B2_APPLICATION_KEY_ID en el Worker.');
    if (!env.B2_APPLICATION_KEY) throw new Error('Falta el secreto B2_APPLICATION_KEY en el Worker.');
    if (!env.B2_BUCKET_ID) throw new Error('Falta B2_BUCKET_ID en el Worker.');
    if (!env.B2_BUCKET_NAME) throw new Error('Falta B2_BUCKET_NAME en el Worker.');
  }
}

async function groqJSON(env, {model, prompt, maxTokens = 32768, schema = null}) {
  requireServices(env, {groq: true});
  const primary = validateGroqModel(model || env.GROQ_MODEL || DEFAULT_DOC_MODEL);
  const fallback = String(env.GROQ_FALLBACK_MODEL || 'openai/gpt-oss-20b').trim();
  const models = [...new Set([primary, fallback].filter(Boolean))];
  let lastError;

  for (let i = 0; i < models.length; i++) {
    const current = models[i];
    const payload = {
      model: current,
      temperature: 0,
      max_completion_tokens: Math.min(Math.max(Number(maxTokens) || 8192, 512), 65536),
      messages: [
        {role: 'system', content: 'Eres un analista documental preciso. Devuelve únicamente JSON válido. No inventes hechos que no estén sustentados por la evidencia suministrada.'},
        {role: 'user', content: String(prompt || '')}
      ],
      response_format: schema ? {
        type: 'json_schema',
        json_schema: {name: 'documentador_response', strict: true, schema}
      } : {type: 'json_object'}
    };

    const response = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      try { await upstreamJson(response, 'Groq'); }
      catch (error) {
        lastError = error;
        const retryable = [429, 500, 502, 503, 504].includes(Number(error.status));
        if (!retryable || i === models.length - 1) throw error;
        continue;
      }
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content || '';
    if (!String(text).trim()) {
      lastError = new Error(`Groq (${current}) devolvió una respuesta vacía.`);
      if (i === models.length - 1) throw lastError;
      continue;
    }
    try { return JSON.parse(cleanJsonText(text)); }
    catch {
      lastError = new Error(`Groq (${current}) no devolvió JSON válido.`);
      if (i === models.length - 1) throw lastError;
    }
  }
  throw lastError || new Error('No fue posible obtener respuesta de Groq.');
}

async function handleChat(request, env) {
  const body = await readJson(request);
  const prompt = String(body.prompt || '').trim();
  if (!prompt) throw Object.assign(new Error('Prompt vacío.'), {status: 400});
  return await groqJSON(env, {
    model: body.model,
    prompt,
    maxTokens: body.maxTokens,
    schema: body.schema && typeof body.schema === 'object' ? body.schema : null
  });
}

function safeFileName(name) {
  return String(name || 'video')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'video';
}

function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

let b2AuthCache = null;

async function b2Authorize(env, force = false) {
  requireServices(env, {b2: true});
  const keyId = String(env.B2_APPLICATION_KEY_ID || '').trim();
  if (!force && b2AuthCache && b2AuthCache.keyId === keyId && b2AuthCache.expiresAt > Date.now()) return b2AuthCache;
  const basic = btoa(`${keyId}:${String(env.B2_APPLICATION_KEY || '')}`);
  const response = await fetch('https://api.backblazeb2.com/b2api/v4/b2_authorize_account', {
    method: 'GET',
    headers: {'Authorization': `Basic ${basic}`}
  });
  const data = await upstreamJson(response, 'Backblaze B2');
  const storage = data?.apiInfo?.storageApi || {};
  if (!data?.authorizationToken || !storage?.apiUrl || !storage?.downloadUrl) {
    throw new Error('Backblaze B2 no devolvió la configuración de Storage API esperada.');
  }
  b2AuthCache = {
    keyId,
    accountId: String(data.accountId || ''),
    authorizationToken: String(data.authorizationToken),
    apiUrl: String(storage.apiUrl),
    downloadUrl: String(storage.downloadUrl),
    absoluteMinimumPartSize: Number(storage.absoluteMinimumPartSize || 5_000_000),
    recommendedPartSize: Number(storage.recommendedPartSize || 100_000_000),
    expiresAt: Date.now() + 20 * 60 * 60 * 1000
  };
  return b2AuthCache;
}

async function b2Api(env, endpoint, body, retry = true) {
  const auth = await b2Authorize(env);
  const response = await fetch(`${auth.apiUrl}/b2api/v4/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': auth.authorizationToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body || {})
  });
  if (response.status === 401 && retry) {
    b2AuthCache = null;
    return await b2Api(env, endpoint, body, false);
  }
  return await upstreamJson(response, 'Backblaze B2');
}

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function sha1Hex(buffer) {
  return bytesToHex(await crypto.subtle.digest('SHA-1', buffer));
}

async function handleMediaCreate(request, env) {
  requireServices(env, {b2: true});
  const body = await readJson(request);
  const name = safeFileName(body.name);
  const size = Number(body.size || 0);
  const mimeType = String(body.mimeType || 'video/mp4').slice(0, 120);
  if (!Number.isFinite(size) || size <= 0) throw Object.assign(new Error('Tamaño de video inválido.'), {status: 400});
  const key = `videos/${Date.now()}-${randomId()}-${name}`;
  const started = await b2Api(env, 'b2_start_large_file', {
    bucketId: String(env.B2_BUCKET_ID),
    fileName: key,
    contentType: mimeType,
    fileInfo: {originalName: name, expectedSize: String(size)}
  });
  const auth = await b2Authorize(env);
  const preferred = Math.max(auth.absoluteMinimumPartSize || 5_000_000, Math.min(32 * 1024 * 1024, auth.recommendedPartSize || 32 * 1024 * 1024));
  return {ok: true, key, uploadId: String(started.fileId), partSize: preferred, storage: 'Backblaze B2'};
}

async function handleMediaPart(request, env) {
  requireServices(env, {b2: true});
  const key = request.headers.get('X-Upload-Key') || '';
  const uploadId = request.headers.get('X-Upload-Id') || '';
  const partNumber = Number(request.headers.get('X-Part-Number') || 0);
  if (!key.startsWith('videos/') || !uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) {
    throw Object.assign(new Error('Datos de parte multipart inválidos.'), {status: 400});
  }
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (declaredLength > 96 * 1024 * 1024) throw Object.assign(new Error('Parte de video demasiado grande.'), {status: 413});
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > 96 * 1024 * 1024) throw Object.assign(new Error('Parte de video inválida o demasiado grande.'), {status: 413});
  const digest = await sha1Hex(bytes);
  const target = await b2Api(env, 'b2_get_upload_part_url', {fileId: uploadId});
  const response = await fetch(String(target.uploadUrl), {
    method: 'POST',
    headers: {
      'Authorization': String(target.authorizationToken),
      'X-Bz-Part-Number': String(partNumber),
      'X-Bz-Content-Sha1': digest,
      'Content-Length': String(bytes.byteLength)
    },
    body: bytes
  });
  const uploaded = await upstreamJson(response, 'Backblaze B2 upload');
  const sha1 = String(uploaded.contentSha1 || digest);
  return {ok: true, partNumber: Number(uploaded.partNumber || partNumber), etag: sha1, sha1};
}

async function handleMediaComplete(request, env) {
  requireServices(env, {b2: true});
  const body = await readJson(request);
  const key = String(body.key || '');
  const uploadId = String(body.uploadId || '');
  const parts = Array.isArray(body.parts) ? body.parts : [];
  if (!key.startsWith('videos/') || !uploadId || !parts.length) throw Object.assign(new Error('Carga multipart incompleta.'), {status: 400});
  const normalized = parts.map(p => ({partNumber: Number(p.partNumber), sha1: String(p.sha1 || p.etag || '')})).sort((a, b) => a.partNumber - b.partNumber);
  if (normalized.some((p, i) => !Number.isInteger(p.partNumber) || p.partNumber !== i + 1 || !/^[a-f0-9]{40}$/i.test(p.sha1))) {
    throw Object.assign(new Error('Lista de partes o SHA1 inválidos.'), {status: 400});
  }
  const done = await b2Api(env, 'b2_finish_large_file', {fileId: uploadId, partSha1Array: normalized.map(p => p.sha1)});
  return {
    ok: true,
    key: String(done.fileName || key),
    fileId: String(done.fileId || uploadId),
    size: Number(done.contentLength || 0),
    contentSha1: String(done.contentSha1 || 'none'),
    storage: 'Backblaze B2'
  };
}

async function handleMediaAbort(request, env) {
  requireServices(env, {b2: true});
  const body = await readJson(request);
  const uploadId = String(body.uploadId || '');
  if (uploadId) await b2Api(env, 'b2_cancel_large_file', {fileId: uploadId}).catch(() => {});
  return {ok: true};
}

function base64Url(bytes) {
  let binary = '';
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function mediaSignature(env, key, exp) {
  const secret = String(env.MEDIA_SIGNING_SECRET || env.APP_TOKEN || '');
  if (!secret) throw new Error('Configura MEDIA_SIGNING_SECRET (o APP_TOKEN) para proteger los videos temporales.');
  const cryptoKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(`${key}|${exp}`));
  return base64Url(sig);
}

async function signedMediaUrl(request, env, key) {
  const exp = Math.floor(Date.now() / 1000) + MEDIA_TTL_SECONDS;
  const sig = await mediaSignature(env, key, exp);
  const u = new URL('/media/file', request.url);
  u.searchParams.set('key', key);
  u.searchParams.set('exp', String(exp));
  u.searchParams.set('sig', sig);
  return u.toString();
}

function encodedB2Path(name) {
  return String(name || '').split('/').map(part => encodeURIComponent(part)).join('/');
}

async function handleMediaFile(request, env) {
  requireServices(env, {b2: true});
  const url = new URL(request.url);
  const key = url.searchParams.get('key') || '';
  const exp = Number(url.searchParams.get('exp') || 0);
  const sig = url.searchParams.get('sig') || '';
  if (!key.startsWith('videos/') || !Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return new Response('Expired', {status: 403});
  const expected = await mediaSignature(env, key, exp);
  if (sig !== expected) return new Response('Forbidden', {status: 403});
  const auth = await b2Authorize(env);
  const direct = `${auth.downloadUrl}/file/${encodeURIComponent(String(env.B2_BUCKET_NAME))}/${encodedB2Path(key)}`;
  const upstreamHeaders = new Headers({'Authorization': auth.authorizationToken});
  const range = request.headers.get('Range');
  if (range) upstreamHeaders.set('Range', range);
  let response = await fetch(direct, {method: 'GET', headers: upstreamHeaders});
  if (response.status === 401) {
    b2AuthCache = null;
    const fresh = await b2Authorize(env, true);
    upstreamHeaders.set('Authorization', fresh.authorizationToken);
    response = await fetch(`${fresh.downloadUrl}/file/${encodeURIComponent(String(env.B2_BUCKET_NAME))}/${encodedB2Path(key)}`, {method: 'GET', headers: upstreamHeaders});
  }
  if (!response.ok && response.status !== 206) return new Response(await response.text().catch(() => 'Backblaze download error'), {status: response.status});
  const headers = new Headers();
  for (const h of ['content-type','content-length','content-range','etag','last-modified','x-bz-content-sha1']) {
    const value = response.headers.get(h);
    if (value) headers.set(h, value);
  }
  headers.set('Accept-Ranges', 'bytes');
  return new Response(response.body, {status: response.status, headers});
}

async function deleteB2File(env, fileName, fileId) {
  if (!fileName || !fileId) return;
  await b2Api(env, 'b2_delete_file_version', {fileName, fileId});
}

function secToStamp(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function extractDeepgramTranscript(data) {
  const duration = Number(data?.metadata?.duration || 0);
  const detectedLanguage = String(data?.results?.channels?.[0]?.detected_language || data?.results?.channels?.[0]?.alternatives?.[0]?.languages?.[0] || 'es');
  let utterances = Array.isArray(data?.results?.utterances) ? data.results.utterances : [];
  if (!utterances.length) {
    const words = data?.results?.channels?.[0]?.alternatives?.[0]?.words || [];
    let current = null;
    for (const w of words) {
      const start = Number(w.start || 0), end = Number(w.end || start);
      if (!current || start - current.end > 1.5 || current.text.length > 700) {
        if (current) utterances.push(current);
        current = {start, end, transcript: String(w.punctuated_word || w.word || '')};
      } else {
        current.end = end;
        current.transcript += ` ${String(w.punctuated_word || w.word || '')}`;
      }
    }
    if (current) utterances.push(current);
  }
  utterances = utterances.map(u => ({
    start: Number(u.start || 0),
    end: Number(u.end || u.start || 0),
    text: String(u.transcript || u.text || '').trim()
  })).filter(u => u.text);
  const full = String(data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || utterances.map(u => u.text).join(' ')).trim();
  return {duration, detectedLanguage, utterances, full};
}

function chunkUtterances(utterances, maxChars = 30_000, maxSeconds = 1800) {
  const chunks = [];
  let current = [];
  let chars = 0;
  let start = null;
  for (const u of utterances) {
    const line = `[${secToStamp(u.start)}-${secToStamp(u.end)}] ${u.text}`;
    const span = start == null ? 0 : u.end - start;
    if (current.length && (chars + line.length > maxChars || span > maxSeconds)) {
      chunks.push(current);
      current = [];
      chars = 0;
      start = null;
    }
    if (start == null) start = u.start;
    current.push(u);
    chars += line.length + 1;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

const ACTION_CHUNK_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    summary: {type: 'string'},
    uncertainties: {type: 'array', items: {type: 'string'}},
    actions: {type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: {
        action: {type: 'string'}, start_seconds: {type: 'number'}, end_seconds: {type: 'number'},
        system: {type: 'string'}, location_path: {type: 'string'}, interface_element: {type: 'string'},
        result: {type: 'string'}, uncertainty: {type: 'string'}, capture_recommended: {type: 'boolean'},
        capture_seconds: {type: 'number'}, capture_reason: {type: 'string'}
      },
      required: ['action','start_seconds','end_seconds','system','location_path','interface_element','result','uncertainty','capture_recommended','capture_seconds','capture_reason']
    }}
  },
  required: ['summary','uncertainties','actions']
};

const ANALYSIS_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    detected_process: {type: 'string'}, selected_guide_index: {type: 'integer'}, selection_reason: {type: 'string'},
    proposed_document_title: {type: 'string'}, supporting_guide_indices: {type: 'array', items: {type: 'integer'}},
    general_requirements: {type: 'array', items: {type: 'string'}},
    sections: {type: 'array', items: {
      type: 'object', additionalProperties: false,
      properties: {
        order: {type: 'integer'}, title: {type: 'string'}, guide_instruction: {type: 'string'},
        criteria: {type: 'array', items: {type: 'string'}}, required: {type: 'boolean'}, status: {type: 'string'},
        evidence: {type: 'array', items: {type: 'string'}}, draft_content: {type: 'string'},
        missing_questions: {type: 'array', items: {
          type: 'object', additionalProperties: false,
          properties: {category:{type:'string'}, question:{type:'string'}, why_needed:{type:'string'}, required:{type:'boolean'}},
          required: ['category','question','why_needed','required']
        }}
      },
      required: ['order','title','guide_instruction','criteria','required','status','evidence','draft_content','missing_questions']
    }},
    warnings: {type: 'array', items: {type: 'string'}}
  },
  required: ['detected_process','selected_guide_index','selection_reason','proposed_document_title','supporting_guide_indices','general_requirements','sections','warnings']
};

const DOCUMENT_SECTION_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    order:{type:'integer'}, title:{type:'string'}, paragraphs:{type:'array',items:{type:'string'}},
    bullets:{type:'array',items:{type:'string'}}, numbered_items:{type:'array',items:{type:'string'}},
    tables:{type:'array',items:{type:'object',additionalProperties:false,properties:{title:{type:'string'},headers:{type:'array',items:{type:'string'}},rows:{type:'array',items:{type:'array',items:{type:'string'}}}},required:['title','headers','rows']}},
    source_basis:{type:'array',items:{type:'string'}}
  },
  required:['order','title','paragraphs','bullets','numbered_items','tables','source_basis']
};

const DRAFT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    title:{type:'string'}, subtitle:{type:'string'}, introductory_note:{type:'string'},
    sections:{type:'array',items:DOCUMENT_SECTION_SCHEMA}, warnings:{type:'array',items:{type:'string'}}
  },
  required:['title','subtitle','introductory_note','sections','warnings']
};

const BUNDLE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {document_analysis: ANALYSIS_SCHEMA, document_draft: DRAFT_SCHEMA},
  required: ['document_analysis','document_draft']
};

function sanitizeGuides(value) {
  const guides = Array.isArray(value) ? value.slice(0, MAX_GUIDES) : [];
  let remaining = MAX_GUIDE_CONTEXT_CHARS;
  return guides.map((g, index) => {
    const original = String(g?.text || '');
    const fair = Math.max(20_000, Math.floor(remaining / Math.max(1, guides.length - index)));
    const text = original.slice(0, fair);
    remaining = Math.max(0, remaining - text.length);
    return {
      index,
      name: String(g?.name || `Guía ${index + 1}`).slice(0, 220),
      structure: Array.isArray(g?.structure) ? g.structure.slice(0, 250).map(v => String(v).slice(0, 500)) : [],
      text,
      truncated: text.length < original.length
    };
  });
}

async function transcribeRemote(env, mediaUrl, model) {
  requireServices(env, {deepgram: true});
  const u = new URL(DEEPGRAM_BASE);
  u.searchParams.set('model', validateSttModel(model));
  u.searchParams.set('language', 'es');
  u.searchParams.set('smart_format', 'true');
  u.searchParams.set('punctuate', 'true');
  u.searchParams.set('utterances', 'true');
  u.searchParams.set('paragraphs', 'true');
  const response = await fetch(u.toString(), {
    method: 'POST',
    headers: {'Authorization': `Token ${env.DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({url: mediaUrl})
  });
  return await upstreamJson(response, 'Deepgram');
}

async function extractActions(env, model, chunk, index, total) {
  const lines = chunk.map(u => `[${secToStamp(u.start)}-${secToStamp(u.end)}] ${u.text}`).join('\n');
  const prompt = `Extrae TODAS las acciones operativas expresadas en este tramo de una grabación de pantalla. Solo dispones de la TRANSCRIPCIÓN, no de la imagen: no inventes botones, rutas, campos ni resultados que no estén mencionados o sean inequívocos en lo dicho. Mantén acciones repetidas cuando correspondan a datos o momentos distintos. Cada acción debe tener un verbo claro y un intervalo temporal dentro del tramo.\n\nPara capture_seconds usa un segundo dentro del intervalo de la acción que sirva como punto de salto manual en el video. capture_recommended=true cuando conviene que el usuario vaya a ese segundo y tome una captura manual (navegación, clic relevante, diligenciamiento, resultado, confirmación); false para narración general o esperas. capture_reason debe indicar brevemente qué conviene buscar visualmente.\n\nTRAMO ${index + 1}/${total}:\n${lines}\n\nDevuelve exclusivamente JSON.`;
  return await groqJSON(env, {model, prompt, maxTokens: 32768, schema: ACTION_CHUNK_SCHEMA});
}

async function buildDocumentBundle(env, model, guides, chunkSummaries, actionStats) {
  const guideContext = JSON.stringify(guides);
  const summaries = chunkSummaries.map((s, i) => `TRAMO ${i + 1}: ${s}`).join('\n');
  const prompt = `Construye el análisis documental y el primer borrador usando las guías institucionales y los resúmenes de una transcripción completa de video.\n\nREGLAS:\n- Las guías definen estructura y criterios; no son evidencia de hechos.\n- Selecciona la guía aplicable por índice cero-basado.\n- Conserva literalmente los títulos y el orden de la guía seleccionada en document_analysis.sections y document_draft.sections.\n- No inventes datos, responsables, rutas, botones o resultados.\n- Solo genera missing_questions cuando falte un dato realmente crítico.\n- En document_draft NO enumeres el paso a paso operativo; la aplicación insertará localmente ${actionStats.count} acciones ACC con timestamps para garantizar cobertura.\n- Usa los resúmenes solo para redactar objetivo, alcance, contexto, responsabilidades u otras secciones sustentadas.\n- Si la guía está truncated, su campo structure es la referencia principal para títulos.\n\nGUÍAS:\n${guideContext}\n\nRESÚMENES CRONOLÓGICOS DEL VIDEO:\n${summaries}\n\nDATOS DE COBERTURA: ${JSON.stringify(actionStats)}\n\nDevuelve exclusivamente JSON con document_analysis y document_draft.`;
  return await groqJSON(env, {model, prompt, maxTokens: 65536, schema: BUNDLE_SCHEMA});
}

async function handleVideoAnalyze(request, env) {
  requireServices(env, {groq: true, deepgram: true});
  const body = await readJson(request);
  const guides = sanitizeGuides(body.guides);
  if (!guides.length) throw Object.assign(new Error('Carga al menos una guía institucional.'), {status: 400});
  const docModel = validateGroqModel(body.model || env.GROQ_MODEL || DEFAULT_DOC_MODEL);
  const sttModel = validateSttModel(body.transcriptionModel || env.DEEPGRAM_MODEL || DEFAULT_STT_MODEL);
  let mediaUrl = String(body.remoteUrl || '').trim();
  let storedKey = String(body.key || '').trim();
  const storedFileId = String(body.fileId || '').trim();
  if (storedKey) {
    requireServices(env, {b2: true});
    mediaUrl = await signedMediaUrl(request, env, storedKey);
  } else if (!/^https:\/\//i.test(mediaUrl)) {
    throw Object.assign(new Error('Falta el video almacenado o una URL HTTPS directa al archivo de video.'), {status: 400});
  }

  const dg = await transcribeRemote(env, mediaUrl, sttModel);
  const transcript = extractDeepgramTranscript(dg);
  if (!transcript.utterances.length) throw Object.assign(new Error('Deepgram no encontró voz utilizable en el video. Esta V19 documenta a partir de la narración del procedimiento.'), {status: 422});

  const chunks = chunkUtterances(transcript.utterances);
  const allActions = [];
  const summaries = [];
  const uncertainties = [];
  for (let i = 0; i < chunks.length; i++) {
    const extracted = await extractActions(env, docModel, chunks[i], i, chunks.length);
    summaries.push(String(extracted?.summary || '').trim());
    for (const u of Array.isArray(extracted?.uncertainties) ? extracted.uncertainties : []) if (String(u).trim()) uncertainties.push(String(u).trim());
    for (const raw of Array.isArray(extracted?.actions) ? extracted.actions : []) {
      const start = Math.max(0, Number(raw.start_seconds) || 0);
      const end = Math.max(start, Number(raw.end_seconds) || start);
      let capture = Number(raw.capture_seconds);
      if (!Number.isFinite(capture) || capture < start || capture > end) capture = start + (end - start) / 2;
      const action = String(raw.action || '').trim();
      if (!action) continue;
      allActions.push({
        action,
        timestamp_start: secToStamp(start),
        timestamp_end: secToStamp(end),
        start_seconds: start,
        end_seconds: end,
        system: String(raw.system || '').trim(),
        location_path: String(raw.location_path || '').trim(),
        interface_element: String(raw.interface_element || '').trim(),
        result: String(raw.result || '').trim(),
        uncertainty: String(raw.uncertainty || '').trim(),
        capture_recommended: raw.capture_recommended !== false,
        capture_timestamp: secToStamp(capture),
        capture_seconds: capture,
        capture_reason: String(raw.capture_reason || 'Ir a este segundo del video para validar visualmente la acción.').trim()
      });
    }
  }

  allActions.sort((a, b) => a.start_seconds - b.start_seconds || a.end_seconds - b.end_seconds);
  const lastTimestamp = secToStamp(transcript.duration || allActions.at(-1)?.end_seconds || 0);
  const bundle = await buildDocumentBundle(env, docModel, guides, summaries, {
    count: allActions.length,
    duration_seconds: transcript.duration,
    last_timestamp: lastTimestamp,
    source: 'Deepgram procesa el archivo completo; Groq extrae acciones desde la transcripción temporal.'
  });

  if (storedKey && storedFileId && body.deleteAfter !== false) await deleteB2File(env, storedKey, storedFileId).catch(() => {});

  const compactTranscript = transcript.full.length > 450_000
    ? transcript.full.slice(0, 450_000) + '\n[Transcripción recortada en la interfaz; el análisis de acciones sí usó todos los tramos.]'
    : transcript.full;

  return {
    ok: true,
    provider: {transcription: 'Deepgram', documentation: 'Groq'},
    duration_seconds: transcript.duration,
    duration_estimate: lastTimestamp,
    detected_language: transcript.detectedLanguage,
    full_transcript: compactTranscript,
    transcript_segments: transcript.utterances.slice(0, 250).map(u => ({start: secToStamp(u.start), end: secToStamp(u.end), text: u.text})),
    actions: allActions,
    uncertainties,
    coverage: {
      complete: true,
      duration_seconds: transcript.duration,
      scope: 'Archivo completo enviado a Deepgram. Acciones derivadas de la narración; no se realizó análisis visual automático.',
      last_timestamp: lastTimestamp
    },
    document_analysis: bundle.document_analysis,
    document_draft: bundle.document_draft,
    optimization: {
      mode: 'b2_deepgram_groq_v19_1',
      transcription_requests: 1,
      action_chunks: chunks.length,
      document_requests: chunks.length + 1,
      notes: 'Sin Gemini. El video se almacena temporalmente en Backblaze B2, Deepgram transcribe con tiempos y Groq redacta.'
    }
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    const url = new URL(request.url);

    if (url.pathname === '/media/file' && request.method === 'GET') {
      try { return await handleMediaFile(request, env); }
      catch (error) { return new Response(String(error?.message || error), {status: Number(error?.status) || 500}); }
    }

    if (!cors) return new Response('Origin not allowed', {status: 403});
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});

    try {
      if (url.pathname === '/health' && request.method === 'GET') {
        return json({
          ok: true,
          service: 'bot-documental-v19-1-b2',
          groqConfigured: !!env.GROQ_API_KEY,
          deepgramConfigured: !!env.DEEPGRAM_API_KEY,
          b2Configured: !!(env.B2_APPLICATION_KEY_ID && env.B2_APPLICATION_KEY && env.B2_BUCKET_ID && env.B2_BUCKET_NAME),
          mediaSigningConfigured: !!(env.MEDIA_SIGNING_SECRET || env.APP_TOKEN),
          tokenRequired: !!env.APP_TOKEN,
          docModel: env.GROQ_MODEL || DEFAULT_DOC_MODEL,
          sttModel: env.DEEPGRAM_MODEL || DEFAULT_STT_MODEL
        }, 200, cors);
      }
      if (!authOk(request, env)) return json({ok: false, error: 'Token de aplicación inválido.'}, 401, cors);

      if (url.pathname === '/chat' && request.method === 'POST') return json(await handleChat(request, env), 200, cors);
      if (url.pathname === '/media/create' && request.method === 'POST') return json(await handleMediaCreate(request, env), 200, cors);
      if (url.pathname === '/media/part' && request.method === 'POST') return json(await handleMediaPart(request, env), 200, cors);
      if (url.pathname === '/media/complete' && request.method === 'POST') return json(await handleMediaComplete(request, env), 200, cors);
      if (url.pathname === '/media/abort' && request.method === 'POST') return json(await handleMediaAbort(request, env), 200, cors);
      if (url.pathname === '/video/analyze' && request.method === 'POST') return json(await handleVideoAnalyze(request, env), 200, cors);
      return json({ok: false, error: 'Ruta no encontrada.'}, 404, cors);
    } catch (error) {
      return json({ok: false, error: String(error?.message || error), details: error?.body || undefined}, Number(error?.status) || 500, cors);
    }
  }
};
