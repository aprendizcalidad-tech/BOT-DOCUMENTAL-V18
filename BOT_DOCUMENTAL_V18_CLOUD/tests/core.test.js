import test from 'node:test';
import assert from 'node:assert/strict';
import {visualForStep,attachActions,assertCoverage} from '../js/trace.js';
import {acceptVerdict} from '../js/video.js';
test('Capturas se vinculan por ID aunque estén invertidas y haya pasos sin imagen',()=>{
 const ev=[{action_id:'ACC-00002',status:'verified'},{action_id:'ACC-00001',status:'manual_approved'}];
 assert.equal(visualForStep('[ACC-00001] Abrir',ev),ev[1]);
 assert.equal(visualForStep('Paso introductorio',ev),null);
 assert.equal(visualForStep('ACC-00001 ACC-00002',ev),null);
 assert.equal(visualForStep('ACC-00003',ev),null);
});
test('Nunca aceptar rechazo, string true, índice fuera de rango ni baja confianza',()=>{
 const good={matched:true,application_match:true,element_match:true,confidence:.95,candidate_index:0};
 assert.ok(acceptVerdict(good,2));
 for(const patch of [{matched:false},{matched:'true'},{candidate_index:2},{candidate_index:NaN},{confidence:.84},{confidence:2},{element_match:false}])assert.equal(acceptVerdict({...good,...patch},2),false);
});
test('Conserva 500 acciones y detecta eliminación accidental de una',()=>{
 const actions=Array.from({length:500},(_,i)=>({action_id:'ACC-'+String(i+1).padStart(5,'0'),action:'Operación '+i,timestamp_start:'00:00:00',timestamp_end:'00:00:01'}));
 const doc={sections:[{order:1,numbered_items:[]}]};attachActions(doc,actions,1);assert.equal(doc.sections[0].numbered_items.length,500);assertCoverage(doc,actions);
 doc.sections[0].numbered_items.splice(10,1);assert.throws(()=>assertCoverage(doc,actions),/1 acciones/);
});
