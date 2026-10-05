import {sha256Blob,jsonBlob} from './utils.js';
import {downloadDriveRange,getDriveMetadata} from './drive.js';
import {cloudJSON,cloudRaw} from './cloud-api.js';

const DEFAULT_PART_BYTES=32*1024*1024;
const MAX_GUIDE_CONTEXT_CHARS=300_000;

export function buildGuidePayload(guides=[]){
  const input=Array.isArray(guides)?guides.slice(0,8):[];
  let remaining=MAX_GUIDE_CONTEXT_CHARS;
  return input.map((g,index)=>{
    const original=String(g?.text||'');
    const fair=Math.max(20_000,Math.floor(remaining/Math.max(1,input.length-index)));
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

async function fingerprintMeta(meta){return await sha256Blob(jsonBlob(meta));}

function normalizeTranscript(raw){
  const t=raw&&typeof raw==='object'?structuredClone(raw):{};
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
    const stamp=h>0?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`;
    return {...a,capture_seconds:sec,capture_timestamp:a.capture_timestamp||stamp};
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

async function createUpload({name,size,mimeType}){
  return await cloudJSON('/media/create',{name,size,mimeType},{retries:2});
}

async function uploadPart({key,uploadId,partNumber,blob}){
  const response=await cloudRaw('/media/part',blob,{
    'X-Upload-Key':key,
    'X-Upload-Id':uploadId,
    'X-Part-Number':String(partNumber)
  },{retries:3});
  return await response.json();
}

async function completeUpload({key,uploadId,parts}){
  return await cloudJSON('/media/complete',{key,uploadId,parts},{retries:2});
}

async function abortUpload({key,uploadId}){
  if(!key)return;
  try{await cloudJSON('/media/abort',{key,uploadId},{retries:0});}catch{}
}

async function uploadVideoToB2({file,driveReference,meta,onProgress=()=>{}}){
  const size=Number(meta?.size??file?.size??0);
  const name=meta?.name||file?.name||'video';
  const mimeType=meta?.mimeType||file?.type||'video/mp4';
  if(!Number.isFinite(size)||size<=0)throw new Error('No se pudo conocer el tamaño del video.');
  const session=await createUpload({name,size,mimeType});
  const partSize=Number(session.partSize)||DEFAULT_PART_BYTES;
  const parts=[];
  let offset=0,partNumber=1;
  try{
    while(offset<size){
      const end=Math.min(size,offset+partSize);
      onProgress(`Subiendo video temporalmente a Backblaze B2 · ${Math.round((offset/size)*100)}%`,.02+.42*(offset/size));
      const blob=driveReference?await downloadDriveRange(driveReference,offset,end-1):file.slice(offset,end);
      if(blob.size!==end-offset)throw new Error(`Bloque incompleto: se recibieron ${blob.size} bytes y se esperaban ${end-offset}.`);
      const part=await uploadPart({key:session.key,uploadId:session.uploadId,partNumber,blob});
      parts.push({partNumber:Number(part.partNumber)||partNumber,etag:String(part.etag||'')});
      offset=end;partNumber++;
    }
    const completed=await completeUpload({key:session.key,uploadId:session.uploadId,parts});
    onProgress('Video cargado en Backblaze B2. Preparando transcripción cloud…',.46);
    return {key:session.key,fileId:String(completed.fileId||session.uploadId),name,mimeType,size};
  }catch(error){
    await abortUpload({key:session.key,uploadId:session.uploadId});
    throw error;
  }
}

export async function processVideo({file,driveReference,remoteUrl,model,transcriptionModel='nova-3',guides=[],onProgress=()=>{}}){
  if(!Array.isArray(guides)||!guides.length)throw new Error('Carga al menos una guía institucional antes de analizar el video.');
  const guidePayload=buildGuidePayload(guides);
  const guideFingerprint=await fingerprintMeta(guidePayload.map(g=>({name:g.name,structure:g.structure,text:g.text,truncated:g.truncated})));
  let name='video',fingerprint='',key='',fileId='',directUrl='';

  if(remoteUrl){
    directUrl=String(remoteUrl).trim();
    if(!/^https:\/\//i.test(directUrl))throw new Error('La URL pública debe ser HTTPS y apuntar directamente a un archivo de audio o video.');
    name='URL remota';
    fingerprint=await fingerprintMeta({remoteUrl:directUrl,guideFingerprint,mode:'v19-1-b2-deepgram-groq'});
    onProgress('Enviando URL remota a Deepgram…',.46);
  }else{
    let meta;
    if(driveReference){
      meta=await getDriveMetadata(driveReference);
      if(!String(meta.mimeType||'').startsWith('video/')&&!String(meta.mimeType||'').startsWith('audio/'))throw new Error('El archivo seleccionado de Drive no es un audio o video compatible.');
      name=meta.name||name;
      fingerprint=await fingerprintMeta({id:meta.id,name:meta.name,size:meta.size,modifiedTime:meta.modifiedTime,md5Checksum:meta.md5Checksum,guideFingerprint,mode:'v19-1-b2-deepgram-groq'});
    }else{
      if(!file)throw new Error('Selecciona un video.');
      name=file.name||name;
      meta={name,size:file.size,mimeType:file.type||'video/mp4'};
      fingerprint=await fingerprintMeta({name:file.name,size:file.size,lastModified:file.lastModified,type:file.type,guideFingerprint,mode:'v19-1-b2-deepgram-groq'});
    }
    const uploaded=await uploadVideoToB2({file:driveReference?null:file,driveReference,meta,onProgress});
    key=uploaded.key;
    fileId=uploaded.fileId;
  }

  onProgress('Deepgram está transcribiendo el archivo completo con timestamps…',.50);
  const raw=await cloudJSON('/video/analyze',{
    key:key||undefined,
    fileId:fileId||undefined,
    remoteUrl:directUrl||undefined,
    model,
    transcriptionModel,
    guides:guidePayload,
    deleteAfter:true
  },{retries:1});
  onProgress('Groq terminó de extraer acciones y preparar el borrador…',.97);
  const transcript=normalizeTranscript(raw);
  return {jobId:'',name,fingerprint,transcript};
}
