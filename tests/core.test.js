import test from 'node:test';
import assert from 'node:assert/strict';
import {attachActions,assertCoverage,assertCaptureReferences,captureReference,formatActionStep} from '../js/trace.js';

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
