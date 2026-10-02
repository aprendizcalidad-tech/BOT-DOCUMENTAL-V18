export function actionIds(text){return [...new Set(String(text).match(/ACC-\d{4,}/g)||[])];}
export function visualForStep(text,evidence){const ids=actionIds(text);return ids.length===1?evidence.find(v=>v.action_id===ids[0]&&['verified','manual_approved'].includes(v.status))||null:null;}
export function attachActions(doc,actions,order){
 const section=doc.sections.find(s=>Number(s.order)===order);if(!section)throw new Error('Elige la sección de los pasos.');
 section.numbered_items=actions.map(a=>`[${a.action_id}] ${a.action}${a.location_path?' · Pantalla: '+a.location_path:''}${a.interface_element?' · Elemento: '+a.interface_element:''}${a.result?' · Resultado: '+a.result:''}${a.uncertainty?' · Por confirmar: '+a.uncertainty:''} (${a.timestamp_start}–${a.timestamp_end})`);
 doc.warnings=[...(doc.warnings||[]),'Las capturas aceptadas por IA requieren revisión antes de aprobar el procedimiento.'];
}
export function assertCoverage(doc,actions){
 const ids=doc.sections.flatMap(s=>(s.numbered_items||[]).flatMap(actionIds));
 const missing=actions.filter(a=>!ids.includes(a.action_id));const known=new Set(actions.map(a=>a.action_id));
 const unknown=ids.filter(id=>!known.has(id));
 if(missing.length||unknown.length)throw new Error(`Trazabilidad inválida: ${missing.length} acciones sin paso; ${unknown.length} referencias desconocidas. Revisa los identificadores ACC de los pasos.`);
}
