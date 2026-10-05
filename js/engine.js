import {sleep,sha256Blob,jsonBlob,cleanJsonText} from './utils.js';
import {downloadDriveRange,getDriveMetadata} from './drive.js';
import {cloudJSON,cloudRaw} from './cloud-api.js';

const MAX_FILE_BYTES=2*1024*1024*1024;
const CHUNK_BYTES=16*1024*1024;
const ACTIVE_KEY='bot-v18-active-video';
const MAX_GUIDE_CONTEXT_CHARS=3_600_000;

function activeJobFor(fingerprint){
  try{
    const value=JSON.parse(sessionStorage.getItem(ACTIVE_KEY)||'null');
    return value?.fingerprint===fingerprint&&value?.jobId?value:null;
  }catch{return null;}
}
function saveActive(jobId,name,fingerprint){sessionStorage.setItem(ACTIVE_KEY,JSON.stringify({jobId,name,fingerprint,savedAt:new Date().toISOString()}));}
function clearActive(jobId){try{const v=JSON.parse(sessionStorage.getItem(ACTIVE_KEY)||'null');if(!jobId||v?.jobId===jobId)sessionStorage.removeItem(ACTIVE_KEY);}catch{sessionStorage.removeItem(ACTIVE_KEY);}}

function fileObject(value){return value?.file || value || {};}
function stateName(value){return String(fileObject(value)?.state || '').toUpperCase();}

export function buildGuidePayload(guides=[]){
  const input=Array.isArray(guides)?guides.slice(0,8):[];
  let remaining=MAX_GUIDE_CONTEXT_CHARS;
  return input.map((g,index)=>{
    const original=String(g?.text||'');
    const fair=Math.max(30_000,Math.floor(remaining/Math.max(1,input.length-index)));
    const text=original.slice(0,fair);
    remaining=Math.max(0,remaining-text.length);
    return {
      name:String(g?.name||`Guía ${index+1}`).slice(0,220),
      structure:Array.isArray(g?.structure)?g.structure.slice(0,250).map(String):[],
      text,
      truncated:text.length<original.length
    };
  });
}

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
    uncertainty:String(a?.uncertainty||'').trim(),
    capture_recommended:a?.capture_recommended!==false,
    capture_seconds:Number.isFinite(Number(a?.capture_seconds))?Number(a.capture_seconds):null,
    capture_timestamp:String(a?.capture_timestamp||'').trim(),
    capture_reason:String(a?.capture_reason||'').trim()
  })).map(a=>{
    const start=Number(a.start_seconds)||0,end=Math.max(start,Number(a.end_seconds)||start);
    let sec=Number(a.capture_seconds);
    if(!Number.isFinite(sec)||sec<start||sec>end)sec=start+(end-start)/2;
    const total=Math.max(0,Math.round(sec)),h=Math.floor(total/3600),m=Math.floor((total%3600)/60),ss=total%60;
    const fallback=h>0?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    return {...a,capture_seconds:sec,capture_timestamp:fallback};
  }).filter(a=>a.action);
  t.full_transcript=String(t.full_transcript||'');
  t.uncertainties=Array.isArray(t.uncertainties)?t.uncertainties.map(String):[];
  t.duration_seconds=Number(t.duration_seconds)||Number(t.coverage?.duration_seconds)||0;
  t.duration_estimate=String(t.duration_estimate||t.coverage?.last_timestamp||'No disponible');
  t.detected_language=String(t.detected_language||'');
  t.transcript_segments=Array.isArray(t.transcript_segments)?t.transcript_segments:[];
  t.coverage=t.coverage&&typeof t.coverage==='object'?t.coverage:{complete:false,duration_seconds:t.duration_seconds,scope:'No informado',last_timestamp:t.duration_estimate};
  return t;
}

async function startInteractionStream({uri,mimeType,youtubeUrl,model,guides,onProgress=()=>{}}){
  const payload={model,guides:buildGuidePayload(guides)};
  if(youtubeUrl)payload.youtubeUrl=youtubeUrl;
  else Object.assign(payload,{uri,mimeType});

  const response=await cloudRaw('/video/stream',JSON.stringify(payload),{'Content-Type':'application/json'},{retries:0});
  if(!response.body)throw new Error('El navegador no pudo abrir el stream de Gemini.');

  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let buffer='';
  let output='';
  let interactionId='';
  let finalStatus='';
  let lastProgressChars=0;

  const processBlock=(block)=>{
    const lines=String(block||'').split(/\r?\n/);
    let eventName='';
    const dataLines=[];
    for(const line of lines){
      if(line.startsWith('event:'))eventName=line.slice(6).trim();
      else if(line.startsWith('data:'))dataLines.push(line.slice(5).trimStart());
    }
    const dataText=dataLines.join('\n').trim();
    if(!dataText||dataText==='[DONE]')return;
    let event;
    try{event=JSON.parse(dataText);}catch{return;}
    const type=String(event?.event_type||eventName||'');
    if(type==='interaction.created'){
      interactionId=String(event?.interaction?.id||interactionId||'');
      onProgress('Gemini recibió el trabajo y está recorriendo el video…',.60);
      return;
    }
    if(type==='interaction.status_update'){
      onProgress('Gemini continúa analizando el video completo…',.66);
      return;
    }
    if(type==='step.delta'&&event?.delta?.type==='text'){
      output+=String(event.delta.text||'');
      if(output.length-lastProgressChars>=5000){
        lastProgressChars=output.length;
        onProgress(`Gemini está construyendo la guía · ${Math.max(1,Math.round(output.length/1000))}k caracteres recibidos`,.72+Math.min(.23,output.length/350000*.23));
      }
      return;
    }
    if(type==='interaction.completed'){
      finalStatus=String(event?.interaction?.status||'completed').toLowerCase();
      interactionId=String(event?.interaction?.id||interactionId||'');
      return;
    }
    if(type.includes('error')||event?.error){
      const message=event?.error?.message||event?.message||'Gemini interrumpió el stream.';
      throw new Error(String(message));
    }
  };

  while(true){
    const {done,value}=await reader.read();
    buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});
    while(true){
      const match=buffer.match(/\r?\n\r?\n/);
      if(!match)break;
      const idx=match.index;
      const block=buffer.slice(0,idx);
      buffer=buffer.slice(idx+match[0].length);
      processBlock(block);
    }
    if(done)break;
  }
  if(buffer.trim())processBlock(buffer);
  if(finalStatus&&finalStatus!=='completed')throw new Error(`El análisis del video terminó con estado ${finalStatus}.`);
  if(!output.trim())throw new Error('Gemini terminó el análisis pero no devolvió contenido utilizable.');
  let raw;
  try{raw=JSON.parse(cleanJsonText(output));}
  catch{throw new Error('La respuesta final del análisis de video no es JSON válido.');}
  onProgress('Análisis completo recibido. Validando acciones y timestamps…',.98);
  return {id:interactionId,transcript:normalizeTranscript(raw)};
}

export async function processVideo({file,driveReference,youtubeUrl,model,guides=[],onProgress=()=>{}}){
  let name='video';
  let fingerprint='';
  let uri='';
  let mimeType='video/mp4';
  if(!Array.isArray(guides)||!guides.length)throw new Error('El modo de video optimizado necesita al menos una guía institucional.');
  const guideFingerprint=await fingerprintMeta(buildGuidePayload(guides).map(g=>({name:g.name,structure:g.structure,text:g.text,truncated:g.truncated})));

  if(youtubeUrl){
    const url=String(youtubeUrl).trim();
    if(!url)throw new Error('Pega una URL pública de YouTube.');
    name='YouTube';
    fingerprint=await fingerprintMeta({youtubeUrl:url,guideFingerprint,mode:'single-interaction-stream-v18.3'});
    onProgress('Enviando referencia de YouTube a Gemini…',.12);
    const result=await startInteractionStream({youtubeUrl:url,model,guides,onProgress});
    return {jobId:result.id||'',name,fingerprint,transcript:result.transcript};
  }

  let meta;
  if(driveReference){
    meta=await getDriveMetadata(driveReference);
    if(!String(meta.mimeType||'').startsWith('video/'))throw new Error('El archivo seleccionado de Drive no es un video.');
    name=meta.name||name;
    mimeType=meta.mimeType||mimeType;
    fingerprint=await fingerprintMeta({id:meta.id,name:meta.name,size:meta.size,modifiedTime:meta.modifiedTime,md5Checksum:meta.md5Checksum,guideFingerprint,mode:'single-interaction-stream-v18.3'});
  }else{
    if(!file)throw new Error('Selecciona un video.');
    name=file.name||name;
    mimeType=file.type||mimeType;
    fingerprint=await fingerprintMeta({name:file.name,size:file.size,lastModified:file.lastModified,type:file.type,guideFingerprint,mode:'single-interaction-stream-v18.3'});
    meta={name,size:file.size,mimeType};
  }

  onProgress('Creando sesión de carga segura en Gemini…',.02);
  const uploaded=await uploadVideo({file,driveReference,meta,onProgress});
  const ready=await waitFileReady(uploaded,onProgress);
  const f=fileObject(ready);
  uri=f.uri;
  mimeType=f.mimeType||f.mime_type||mimeType;
  if(!uri)throw new Error('No se obtuvo la URI activa del video en Gemini.');

  onProgress('Iniciando una sola interacción en streaming: video + guía + borrador…',.56);
  const result=await startInteractionStream({uri,mimeType,model,guides,onProgress});
  return {jobId:result.id||'',name,fingerprint,transcript:result.transcript};
}

