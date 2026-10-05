import test from 'node:test';
import assert from 'node:assert/strict';
import {attachActions,assertCoverage,assertCaptureReferences,captureReference,formatActionStep} from '../js/trace.js';
import {normalizeBundledAnalysis,bundledDraft,applyAnswersLocally,auditVideoDeterministic} from '../js/local-ai.js';
import {buildGuidePayload} from '../js/engine.js';

test('Calcula o conserva el segundo exacto sugerido para captura manual',()=>{
 const explicit={start_seconds:10,end_seconds:20,capture_seconds:17,capture_timestamp:'00:17',capture_recommended:true};
 assert.deepEqual(captureReference(explicit),{recommended:true,seconds:17,timestamp:'00:17',reason:''});
 const fallback=captureReference({start_seconds:100,end_seconds:110,capture_recommended:true});
 assert.equal(fallback.seconds,105);assert.equal(fallback.timestamp,'01:45');
});

test('Cada acción queda con rango de video y captura sugerida, sin imágenes automáticas',()=>{
 const action={action_id:'ACC-00001',action:'Selecciona Guardar',timestamp_start:'00:12:10',timestamp_end:'00:12:16',start_seconds:730,end_seconds:736,capture_seconds:734,capture_timestamp:'00:12:14',capture_recommended:true,location_path:'Solicitud',interface_element:'Botón Guardar',result:'Solicitud registrada'};
 const step=formatActionStep(action);
 assert.match(step,/ACC-00001/);assert.match(step,/Video: 00:12:10–00:12:16/);assert.match(step,/Captura sugerida: 00:12:14/);assert.doesNotMatch(step,/data:image|evidence_/);
});

test('Conserva 500 acciones y valida cobertura + referencias temporales',()=>{
 const actions=Array.from({length:500},(_,i)=>({action_id:'ACC-'+String(i+1).padStart(5,'0'),action:'Operación '+i,timestamp_start:'00:00:00',timestamp_end:'00:00:02',start_seconds:0,end_seconds:2,capture_seconds:1,capture_timestamp:'00:01',capture_recommended:true}));
 const doc={sections:[{order:1,numbered_items:[]}],warnings:[]};attachActions(doc,actions,1);assert.equal(doc.sections[0].numbered_items.length,500);assertCoverage(doc,actions);assertCaptureReferences(doc,actions);
 doc.sections[0].numbered_items[10]=doc.sections[0].numbered_items[10].replace('Captura sugerida: 00:01','Captura eliminada');
 assert.throws(()=>assertCaptureReferences(doc,actions),/referencias de video\/captura/);
 doc.sections[0].numbered_items.splice(11,1);assert.throws(()=>assertCoverage(doc,actions),/1 acciones/);
});

test('Modo cuota optimizada normaliza análisis+borrador y aplica respuestas sin IA',()=>{
 const guides=[{name:'Guía A',text:'Objetivo\nProcedimiento',structure:['Objetivo','Procedimiento']}];
 const analysis=normalizeBundledAnalysis({detected_process:'Compras',selected_guide_index:0,selection_reason:'Coincide',proposed_document_title:'Procedimiento Compras',supporting_guide_indices:[],general_requirements:[],warnings:[],sections:[{order:1,title:'Objetivo',guide_instruction:'Definir objetivo',criteria:['Debe tener objetivo'],required:true,status:'parcial',evidence:['Video'],draft_content:'Gestionar compras',missing_questions:[{category:'Dato',question:'¿Quién aprueba?',why_needed:'Responsable',required:true}]},{order:2,title:'Procedimiento',guide_instruction:'Paso a paso',criteria:['Acciones'],required:true,status:'completo',evidence:['Video'],draft_content:'',missing_questions:[]}]},guides);
 const draft=bundledDraft({title:'Procedimiento Compras',subtitle:'',introductory_note:'',warnings:[],sections:[{order:1,title:'Objetivo',paragraphs:['Gestionar compras'],bullets:[],numbered_items:[],tables:[],source_basis:['Video']},{order:2,title:'Procedimiento',paragraphs:[],bullets:[],numbered_items:[],tables:[],source_basis:['Video']}]},analysis);
 const merged=applyAnswersLocally(draft,[{section_title:'Objetivo',question:'¿Quién aprueba?',answer:'El líder del proceso'}]);
 assert.match(merged.sections[0].paragraphs.join(' '),/El líder del proceso/);
 const audit=auditVideoDeterministic({analysis,document:merged,answers:[{section_title:'Objetivo',question:'¿Quién aprueba?',answer:'El líder del proceso'}],coverage:{complete:true}});
 assert.equal(audit.validation.every(v=>v.status==='cumple'),false); // Procedimiento todavía no tiene contenido antes de insertar acciones.
});

test('El payload de guías para video excluye archivos y limita contexto',()=>{
 const guides=[{name:'g.docx',text:'x'.repeat(100000),structure:['A'],file:{huge:true}}];
 const payload=buildGuidePayload(guides);
 assert.equal(payload.length,1);assert.equal(payload[0].name,'g.docx');assert.equal('file' in payload[0],false);assert.ok(payload[0].text.length<=3600000);
});
