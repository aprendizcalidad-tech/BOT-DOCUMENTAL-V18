import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {setCloudConfig} from '../js/cloud-api.js';
import {processVideo} from '../js/engine.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
setCloudConfig({backendUrl:'https://example.workers.dev',appToken:'app-secret'});

function videoResult(){
 return {
  duration_seconds:120,duration_estimate:'00:02:00',detected_language:'es',full_transcript:'Proceso de prueba',transcript_segments:[],
  actions:[{action:'Selecciona Guardar',timestamp_start:'00:10',timestamp_end:'00:12',start_seconds:10,end_seconds:12,system:'Sistema',location_path:'Formulario',interface_element:'Guardar',result:'Registro guardado',uncertainty:'',capture_recommended:true,capture_timestamp:'00:11',capture_seconds:11,capture_reason:'Se observa el botón y la confirmación'}],
  uncertainties:[],coverage:{complete:true,duration_seconds:120,scope:'video completo',last_timestamp:'00:02:00'},
  document_analysis:{detected_process:'Prueba',selected_guide_index:0,selection_reason:'Coincide',proposed_document_title:'Procedimiento',supporting_guide_indices:[],general_requirements:[],sections:[],warnings:[]},
  document_draft:{title:'Procedimiento',subtitle:'',introductory_note:'',sections:[],warnings:[]},
  optimization:{mode:'single_interaction_video_bundle',model_requests_planned:1,notes:'una llamada'}
 };
}

function sseFor(obj){
 const json=JSON.stringify(obj);
 const mid=Math.floor(json.length/2);
 const events=[
  ['interaction.created',{event_type:'interaction.created',interaction:{id:'v1_streamtest',status:'in_progress'}}],
  ['step.delta',{event_type:'step.delta',delta:{type:'text',text:json.slice(0,mid)}}],
  ['step.delta',{event_type:'step.delta',delta:{type:'text',text:json.slice(mid)}}],
  ['interaction.completed',{event_type:'interaction.completed',interaction:{id:'v1_streamtest',status:'completed'}}]
 ];
 return events.map(([name,data])=>`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join('')+'event: done\ndata: [DONE]\n\n';
}

test('Video YouTube usa un solo stream y no consulta GET /interactions',async()=>{
 const calls=[];
 globalThis.fetch=async(url,opts={})=>{
  calls.push({url:String(url),opts});
  assert.equal(String(url),'https://example.workers.dev/video/stream');
  assert.equal(opts.method,'POST');
  assert.equal(new Headers(opts.headers).get('X-App-Token'),'app-secret');
  return new Response(sseFor(videoResult()),{status:200,headers:{'Content-Type':'text/event-stream'}});
 };
 const result=await processVideo({youtubeUrl:'https://youtu.be/abc123',model:'gemini-3.8-flash',guides:[{name:'Guía',text:'Objetivo\nProcedimiento',structure:['Objetivo','Procedimiento']}],onProgress:()=>{}});
 assert.equal(calls.length,1);
 assert.equal(result.jobId,'v1_streamtest');
 assert.equal(result.transcript.actions.length,1);
 assert.equal(result.transcript.actions[0].action_id,'ACC-00001');
 assert.equal(result.transcript.actions[0].capture_timestamp,'00:11');
 assert.ok(calls.every(c=>!c.url.includes('/interactions/')));
});
