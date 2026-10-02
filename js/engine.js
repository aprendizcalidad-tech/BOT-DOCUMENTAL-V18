import {sleep,sha256Blob,jsonBlob,cleanJsonText} from './utils.js';
import {downloadDriveRange,getDriveMetadata} from './drive.js';
import {cloudJSON,cloudRaw} from './cloud-api.js';

const MAX_FILE_BYTES=2*1024*1024*1024;
const CHUNK_BYTES=16*1024*1024;
const ACTIVE_KEY='bot-v18-active-video';

function activeJobFor(fingerprint){
  try{
    const value=JSON.parse(sessionStorage.getItem(ACTIVE_KEY)||'null');
    return value?.fingerprint===fingerprint&&value?.jobId?value:null;
  }catch{return null;}
}
function saveActive(jobId,name,fingerprint,extra={}){sessionStorage.setItem(ACTIVE_KEY,JSON.stringify({jobId,name,fingerprint,...extra,savedAt:new Date().toISOString()}));}
function clearActive(jobId){try{const v=JSON.parse(sessionStorage.getItem(ACTIVE_KEY)||'null');if(!jobId||v?.jobId===jobId)sessionStorage.removeItem(ACTIVE_KEY);}catch{sessionStorage.removeItem(ACTIVE_KEY);}}

function fileObject(value){return value?.file || value || {};}
function stateName(value){return String(fileObject(value)?.state || '').toUpperCase();}

async function fingerprintMeta(meta){
  return await sha256Blob(jsonBlob(meta));
}

async function startUpload({name,size,mimeType}){
  return await cloudJSON('/files/start',{name,size,mimeType});
}

async function queryUpload(uploadUrl){
  const response=await cloudRaw('/files/query',new Blob([]),{'X-Upload-URL':uploadUrl},{retries:2});
  return await response.json();
}

async function sendChunk(uploadUrl,offset,blob,isFinal){
  const end=offset+blob.size;
  let lastError;
  for(let attempt=0;attempt<6;attempt++){
    try{
      const response=await cloudRaw('/files/chunk',blob,{
        'X-Upload-URL':uploadUrl,
        'X-Upload-Offset':String(offset),
        'X-Upload-Final':isFinal?'1':'0'
      },{retries:0});
      return await response.json();
    }catch(error){
      lastError=error;
      // Las cargas reanudables de Google permiten consultar el offset confirmado. Así evitamos reenviar
      // un bloque que Google ya recibió cuando se pierde solo la respuesta de red.
      try{
        const q=await queryUpload(uploadUrl);
        if(q.offset===end&&!isFinal)return {ok:true,offset:end,recovered:true};
        if(q.offset!==offset){
          if(isFinal&&q.offset===end)throw new Error('Google recibió el último bloque, pero se perdió la confirmación final. Pulsa Analizar otra vez para reiniciar la carga de forma segura.');
          throw new Error(`La sesión reanudable quedó en un offset inesperado (${q.offset}; esperado ${offset}).`);
        }
      }catch(queryError){
        if(String(queryError?.message||'').includes('último bloque')||String(queryError?.message||'').includes('offset inesperado'))throw queryError;
      }
      if(attempt<5)await sleep(Math.min(15000,1000*2**attempt));
    }
  }
  throw lastError||new Error('No se pudo enviar un bloque del video.');
}

async function uploadVideo({file,driveReference,meta,onProgress}){
  const size=Number(meta?.size ?? file?.size ?? 0);
  const name=meta?.name || file?.name || 'video';
  const mimeType=meta?.mimeType || file?.type || 'video/mp4';
  if(!size)throw new Error('No se pudo conocer el tamaño del video.');
  if(size>MAX_FILE_BYTES)throw new Error('Este video supera 2 GB. En el nivel gratuito de Gemini usa la opción YouTube con un video público.');
  const session=await startUpload({name,size,mimeType});
  let offset=0;
  while(offset<size){
    const end=Math.min(size,offset+CHUNK_BYTES);
    onProgress(`Enviando video a Gemini · ${Math.round((offset/size)*100)}%`,.04+.42*(offset/size));
    const blob=driveReference
      ? await downloadDriveRange(driveReference,offset,end-1)
      : file.slice(offset,end);
    if(blob.size!==end-offset)throw new Error(`El bloque de video recibido tiene ${blob.size} bytes; se esperaban ${end-offset}.`);
    const result=await sendChunk(session.uploadUrl,offset,blob,end===size);
    offset=end;
    if(end===size){
      const uploaded=fileObject(result);
      if(!uploaded?.uri&&!result?.file?.uri)throw new Error('Gemini no devolvió la URI del video después de cargarlo.');
      return result;
    }
  }
  throw new Error('La carga del video terminó sin respuesta final.');
}

async function waitFileReady(value,onProgress){
  let current=value;
  const first=fileObject(current);
  const name=first?.name;
  if(!name)return current;
  for(let i=0;i<720;i++){
    const state=stateName(current);
    if(['ACTIVE','SUCCEEDED','READY',''].includes(state))return current;
    if(['FAILED','ERROR'].includes(state))throw new Error(`Gemini no pudo preparar el video (${state}).`);
    onProgress('Gemini está preparando el video…',.48+Math.min(.08,i/720*.08));
    await sleep(2500);
    current=await cloudJSON('/files/status?name='+encodeURIComponent(name));
  }
  throw new Error('El video sigue procesándose en Gemini. Reintenta más tarde.');
}

function extractOutputText(interaction){
  if(typeof interaction?.output_text==='string'&&interaction.output_text.trim())return interaction.output_text;
  const text=(interaction?.steps||[])
    .filter(step=>step?.type==='model_output')
    .flatMap(step=>step?.content||[])
    .filter(part=>part?.type==='text')
    .map(part=>part?.text||'')
    .join('')
    .trim();
  return text;
}

function normalizeTranscript(raw){
  const t=raw&&typeof raw==='object'?raw:{};
  const actions=Array.isArray(t.actions)?t.actions:[];
  t.actions=actions.map((a,i)=>({
    action_id:`ACC-${String(i+1).padStart(5,'0')}`,
    action:String(a?.action||'').trim(),
    timestamp_start:String(a?.timestamp_start||'').trim(),
    timestamp_end:String(a?.timestamp_end||'').trim(),
    start_seconds:Number(a?.start_seconds)||0,
    end_seconds:Number(a?.end_seconds)||Number(a?.start_seconds)||0,
    system:String(a?.system||'').trim(),
    location_path:String(a?.location_path||a?.system||'').trim(),
    interface_element:String(a?.interface_element||'').trim(),
    result:String(a?.result||'').trim(),
    uncertainty:String(a?.uncertainty||'').trim()
  })).filter(a=>a.action);
  t.full_transcript=String(t.full_transcript||'');
  t.uncertainties=Array.isArray(t.uncertainties)?t.uncertainties.map(String):[];
  t.duration_seconds=Number(t.duration_seconds)||Number(t.coverage?.duration_seconds)||0;
  t.duration_estimate=String(t.duration_estimate||t.coverage?.last_timestamp||'No disponible');
  t.detected_language=String(t.detected_language||'');
  t.transcript_segments=Array.isArray(t.transcript_segments)?t.transcript_segments:[];
  t.coverage=t.coverage&&typeof t.coverage==='object'?t.coverage:{complete:false,duration_seconds:t.duration_seconds,scope:'No informado',last_timestamp:t.duration_estimate};
  return t;
}

async function startInteraction({uri,mimeType,youtubeUrl,model}){
  return await cloudJSON('/video/start',youtubeUrl?{youtubeUrl,model}:{uri,mimeType,model},{retries:3});
}

function isBlobstoreUriRegression(error){
  return /Unsupported file uri:\s*blobstore:\/\//i.test(String(error?.message||error||''));
}

async function analyzeDirect({uri,mimeType,youtubeUrl,model,onProgress=()=>{}}){
  onProgress('Gemini reportó un fallo interno de URI; activando ruta alternativa AGENTIC…',.62);
  const payload=youtubeUrl?{youtubeUrl,model}:{uri,mimeType,model};
  const result=await cloudJSON('/video/direct',payload,{retries:1});
  return normalizeTranscript(result?.transcript||result);
}

export async function awaitJob(id,onProgress=()=>{}){
  for(let i=0;i<2160;i++){
    const interaction=await cloudJSON('/interactions/'+encodeURIComponent(id),undefined,{retries:5});
    const status=String(interaction?.status||'').toLowerCase();
    if(status==='completed'){
      const text=extractOutputText(interaction);
      if(!text)throw new Error('Gemini terminó el video pero no devolvió contenido.');
      let raw;
      try{raw=JSON.parse(cleanJsonText(text));}catch{throw new Error('La respuesta final del análisis de video no es JSON válido.');}
      return normalizeTranscript(raw);
    }
    if(['failed','cancelled','canceled','incomplete'].includes(status)){
      clearActive(id);
      const reason=interaction?.error?.message||interaction?.error||status;
      throw new Error('El análisis del video terminó con estado '+reason+'.');
    }
    const processingSteps=(interaction?.steps||[]).filter(s=>s?.type==='processing_result').length;
    onProgress(processingSteps?`Gemini está recorriendo el video · ${processingSteps} segmentos consultados`:'Gemini está analizando el video en segundo plano…',.58+Math.min(.38,i/600*.38));
    await sleep(5000);
  }
  throw new Error('El análisis de video no terminó dentro de la sesión actual.');
}

export async function processVideo({file,driveReference,youtubeUrl,model,onProgress=()=>{}}){
  let name='video';
  let fingerprint='';
  let uri='';
  let mimeType='video/mp4';

  if(youtubeUrl){
    const url=String(youtubeUrl).trim();
    if(!url)throw new Error('Pega una URL pública de YouTube.');
    name='YouTube';
    fingerprint=await fingerprintMeta({youtubeUrl:url});
    const active=activeJobFor(fingerprint);
    if(active){
      onProgress('Reanudando el análisis cloud que ya estaba en curso…',.56);
      try{
        const transcript=await awaitJob(active.jobId,onProgress);
        clearActive(active.jobId);
        return {jobId:active.jobId,name:active.name||name,fingerprint,transcript};
      }catch(error){
        clearActive(active.jobId);
        if(!isBlobstoreUriRegression(error))throw error;
        const transcript=await analyzeDirect({youtubeUrl:url,model,onProgress});
        return {jobId:null,name:active.name||name,fingerprint,transcript};
      }
    }
    onProgress('Enviando referencia de YouTube a Gemini…',.12);
    const interaction=await startInteraction({youtubeUrl:url,model});
    if(!interaction?.id)throw new Error('Gemini no devolvió el ID del trabajo de video.');
    saveActive(interaction.id,name,fingerprint,{youtubeUrl:url});
    try{
      const transcript=await awaitJob(interaction.id,onProgress);
      clearActive(interaction.id);
      return {jobId:interaction.id,name,fingerprint,transcript};
    }catch(error){
      clearActive(interaction.id);
      if(!isBlobstoreUriRegression(error))throw error;
      const transcript=await analyzeDirect({youtubeUrl:url,model,onProgress});
      return {jobId:null,name,fingerprint,transcript};
    }
  }

  let meta;
  if(driveReference){
    meta=await getDriveMetadata(driveReference);
    if(!String(meta.mimeType||'').startsWith('video/'))throw new Error('El archivo seleccionado de Drive no es un video.');
    name=meta.name||name;
    mimeType=meta.mimeType||mimeType;
    fingerprint=await fingerprintMeta({id:meta.id,name:meta.name,size:meta.size,modifiedTime:meta.modifiedTime,md5Checksum:meta.md5Checksum});
  }else{
    if(!file)throw new Error('Selecciona un video.');
    name=file.name||name;
    mimeType=file.type||mimeType;
    fingerprint=await fingerprintMeta({name:file.name,size:file.size,lastModified:file.lastModified,type:file.type});
    meta={name,size:file.size,mimeType};
  }

  const active=activeJobFor(fingerprint);
  if(active){
    onProgress('Reanudando el análisis cloud que ya estaba en curso…',.56);
    try{
      const transcript=await awaitJob(active.jobId,onProgress);
      clearActive(active.jobId);
      return {jobId:active.jobId,name:active.name||name,fingerprint,transcript};
    }catch(error){
      clearActive(active.jobId);
      if(!isBlobstoreUriRegression(error))throw error;
      if(active.uri){
        const transcript=await analyzeDirect({uri:active.uri,mimeType:active.mimeType||mimeType,model,onProgress});
        return {jobId:null,name:active.name||name,fingerprint,transcript};
      }
      onProgress('La sesión anterior de Gemini quedó inválida; reanudando desde una carga limpia…',.02);
    }
  }

  onProgress('Creando sesión de carga segura en Gemini…',.02);
  const uploaded=await uploadVideo({file,driveReference,meta,onProgress});
  const ready=await waitFileReady(uploaded,onProgress);
  const f=fileObject(ready);
  uri=f.uri;
  mimeType=f.mimeType||f.mime_type||mimeType;
  if(!uri)throw new Error('No se obtuvo la URI activa del video en Gemini.');

  onProgress('Iniciando análisis agentic del video completo…',.56);
  const interaction=await startInteraction({uri,mimeType,model});
  if(!interaction?.id)throw new Error('Gemini no devolvió el ID del trabajo de video.');
  saveActive(interaction.id,name,fingerprint,{uri,mimeType});
  try{
    const transcript=await awaitJob(interaction.id,onProgress);
    clearActive(interaction.id);
    return {jobId:interaction.id,name,fingerprint,transcript};
  }catch(error){
    clearActive(interaction.id);
    if(!isBlobstoreUriRegression(error))throw error;
    const transcript=await analyzeDirect({uri,mimeType,model,onProgress});
    return {jobId:null,name,fingerprint,transcript};
  }
}
