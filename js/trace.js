export function actionIds(text){return [...new Set(String(text).match(/ACC-\d{4,}/g)||[])];}

export function secondsToClock(value){
 const total=Math.max(0,Math.round(Number(value)||0));
 const h=Math.floor(total/3600),m=Math.floor((total%3600)/60),s=total%60;
 return h>0?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

export function captureReference(action={}){
 const start=Number.isFinite(Number(action.start_seconds))?Number(action.start_seconds):0;
 const end=Number.isFinite(Number(action.end_seconds))?Number(action.end_seconds):start;
 const boundedEnd=Math.max(start,end);
 let sec=Number(action.capture_seconds);
 if(!Number.isFinite(sec)||sec<start||sec>boundedEnd)sec=start+(boundedEnd-start)/2;
 const timestamp=String(action.capture_timestamp||'').trim()||secondsToClock(sec);
 return {
  recommended:action.capture_recommended!==false,
  seconds:sec,
  timestamp,
  reason:String(action.capture_reason||'').trim()
 };
}

export function formatActionStep(action={}){
 const ref=captureReference(action);
 const range=[action.timestamp_start,action.timestamp_end].filter(Boolean).join('–')||ref.timestamp;
 const details=[
  `[${action.action_id}] ${String(action.action||'').trim()}`,
  action.location_path?`Pantalla: ${action.location_path}`:'',
  action.interface_element?`Elemento: ${action.interface_element}`:'',
  action.result?`Resultado: ${action.result}`:'',
  action.uncertainty?`Por confirmar: ${action.uncertainty}`:'',
  `Video: ${range}`,
  ref.recommended?`Captura sugerida: ${ref.timestamp}`:'Captura sugerida: no necesaria'
 ].filter(Boolean);
 return details.join(' · ');
}

export function attachActions(doc,actions,order){
 const section=(doc.sections||[]).find(s=>Number(s.order)===Number(order));
 if(!section)throw new Error('No se encontró la sección elegida para insertar los pasos del video.');
 section.numbered_items=(actions||[]).map(formatActionStep);
 const recommended=(actions||[]).filter(a=>captureReference(a).recommended).length;
 doc.warnings=[...(doc.warnings||[]),`El video incluye ${actions.length} acciones trazadas. Se sugieren ${recommended} capturas manuales con minuto/segundo exacto; no se extraen imágenes automáticamente.`];
 return doc;
}

export function assertCoverage(doc,actions){
 const ids=doc.sections.flatMap(s=>(s.numbered_items||[]).flatMap(actionIds));
 const missing=actions.filter(a=>!ids.includes(a.action_id));const known=new Set(actions.map(a=>a.action_id));
 const extra=[...new Set(ids.filter(x=>!known.has(x)))];
 const duplicates=[...new Set(ids.filter((x,i)=>ids.indexOf(x)!==i))];
 if(missing.length||extra.length||duplicates.length){
  const parts=[];if(missing.length)parts.push(`${missing.length} acciones faltantes`);if(extra.length)parts.push(`${extra.length} IDs desconocidos`);if(duplicates.length)parts.push(`${duplicates.length} acciones duplicadas`);
  throw new Error('La trazabilidad del video no está completa: '+parts.join(', ')+'.');
 }
 return true;
}

export function assertCaptureReferences(doc,actions){
 const items=doc.sections.flatMap(s=>s.numbered_items||[]);
 const failures=[];
 for(const action of actions||[]){
  const step=items.find(t=>actionIds(t).includes(action.action_id));
  if(!step){failures.push(action.action_id);continue;}
  const ref=captureReference(action);
  if(!String(step).includes('Video:')){failures.push(action.action_id);continue;}
  const expected=ref.recommended?`Captura sugerida: ${ref.timestamp}`:'Captura sugerida: no necesaria';
  if(!String(step).includes(expected))failures.push(action.action_id);
 }
 if(failures.length)throw new Error(`Faltan referencias de video/captura en ${failures.length} acciones (${failures.slice(0,8).join(', ')}${failures.length>8?'…':''}). Regenera los pasos del video o restaura sus marcas de tiempo.`);
 return true;
}
