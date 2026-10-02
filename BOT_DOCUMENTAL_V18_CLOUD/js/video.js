import {parseClock,clock} from './utils.js';
import {chooseVisualCandidate} from './local-ai.js';
import {idbGet,idbSet} from './storage.js';
function waitEvent(el,name,trigger){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>done(new Error('Tiempo agotado al decodificar video')),20000);const ok=()=>done(),bad=()=>done(new Error('Formato de video no compatible'));function done(error){clearTimeout(timer);el.removeEventListener(name,ok);el.removeEventListener('error',bad);error?reject(error):resolve();}el.addEventListener(name,ok,{once:true});el.addEventListener('error',bad,{once:true});trigger?.();});}
export async function loadVideoFile(file,video){if(video.src.startsWith('blob:'))URL.revokeObjectURL(video.src);await waitEvent(video,'loadeddata',()=>{video.preload='auto';video.src=URL.createObjectURL(file);video.load();});return {duration:video.duration};}
export async function captureFrame(video,canvas,sec){if(!Number.isFinite(sec)||sec<0||sec>=video.duration)throw new Error('Tiempo fuera del video');if(Math.abs(video.currentTime-sec)>.01)await waitEvent(video,'seeked',()=>video.currentTime=sec);const scale=Math.min(1,1600/video.videoWidth);canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);return {second:sec,timestamp:clock(sec),dataUrl:canvas.toDataURL('image/jpeg',.9)};}
export function acceptVerdict(v,n){return v?.matched===true&&v.application_match===true&&v.element_match===true&&Number.isInteger(v.candidate_index)&&v.candidate_index>=0&&v.candidate_index<n&&Number.isFinite(v.confidence)&&v.confidence>=.85&&v.confidence<=1;}
export async function buildVisualEvidence({apiKey,model,actions,video,canvas,duration,capture,checkpointKey,onProgress=()=>{}}){
 duration=duration||video.duration;capture=capture||((s)=>captureFrame(video,canvas,s));const results=[];
 for(let i=0;i<actions.length;i++){
  const a=actions[i],key=checkpointKey+':'+a.action_id,cached=await idbGet(key);
  if(cached){results.push(cached);onProgress(`Captura recuperada ${i+1}/${actions.length}`,(i+1)/actions.length);continue;}
  const start=a.start_seconds??parseClock(a.timestamp_start),end=a.end_seconds??parseClock(a.timestamp_end),candidates=[];
  let verdict={},reason='';
  if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&end>=start&&start<duration){
   const next=actions[i+1]?.start_seconds??duration;
   const upper=Math.min(duration-.05,Math.max(start,Math.min(end+.5,next)));
   const times=[...(Number.isFinite(a.evidence_seconds)?[a.evidence_seconds]:[]),start,start+(upper-start)*.25,(start+upper)/2,start+(upper-start)*.75,upper];
   for(const sec of [...new Set(times.map(s=>Math.round(s*100)/100))]){
    try{candidates.push(await capture(sec));}catch(e){reason=e.message;}
   }
   if(candidates.length)try{verdict=await chooseVisualCandidate({apiKey,model,action:a,candidates});}catch(e){reason=e.message;}
  }else reason='Marcas de tiempo inválidas';
  const accepted=acceptVerdict(verdict,candidates.length),index=accepted?verdict.candidate_index:-1;
  const item={action_id:a.action_id,action:a.action,timestamp:a.timestamp_start,status:accepted?'verified':'manual_review',confidence:verdict.confidence||0,selected_index:index,selected:accepted?candidates[index]:null,candidates:accepted?[candidates[index]]:candidates,reject_reason:accepted?'':reason||verdict.reject_reason||'No hay coincidencia visual suficientemente clara.'};
  if(accepted)item.selected_index=0;
  await idbSet(key,item);results.push(item);onProgress(`Captura ${i+1}/${actions.length} · ${item.status}`,(i+1)/actions.length);
 }
 return results;
}
