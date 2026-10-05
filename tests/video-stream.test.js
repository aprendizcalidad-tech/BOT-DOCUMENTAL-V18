import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {setCloudConfig} from '../js/cloud-api.js';
import {processVideo} from '../js/engine.js';

if(!globalThis.crypto)globalThis.crypto=webcrypto;
setCloudConfig({backendUrl:'https://example.workers.dev',appToken:'app-secret'});

function videoResult(){
 return {
  ok:true,duration_seconds:120,duration_estimate:'02:00',detected_language:'es',full_transcript:'Proceso de prueba',transcript_segments:[],
  actions:[{action:'Selecciona Guardar',timestamp_start:'00:10',timestamp_end:'00:12',start_seconds:10,end_seconds:12,system:'Sistema',location_path:'Formulario',interface_element:'Guardar',result:'Registro guardado',uncertainty:'',capture_recommended:true,capture_timestamp:'00:11',capture_seconds:11,capture_reason:'Ir a este segundo para tomar la captura'}],
  uncertainties:[],coverage:{complete:true,duration_seconds:120,scope:'archivo completo',last_timestamp:'02:00'},
  document_analysis:{detected_process:'Prueba',selected_guide_index:0,selection_reason:'Coincide',proposed_document_title:'Procedimiento',supporting_guide_indices:[],general_requirements:[],sections:[],warnings:[]},
  document_draft:{title:'Procedimiento',subtitle:'',introductory_note:'',sections:[],warnings:[]},
  optimization:{mode:'r2_deepgram_groq_v19',transcription_requests:1,action_chunks:1,document_requests:2,notes:'sin gemini'}
 };
}

test('URL remota usa Deepgram+Groq por /video/analyze y conserva minuto exacto',async()=>{
 const calls=[];
 globalThis.fetch=async(url,opts={})=>{
  calls.push({url:String(url),opts});
  assert.equal(String(url),'https://example.workers.dev/video/analyze');
  assert.equal(opts.method,'POST');
  assert.equal(new Headers(opts.headers).get('X-App-Token'),'app-secret');
  const body=JSON.parse(opts.body);
  assert.equal(body.remoteUrl,'https://cdn.example/video.mp4');
  assert.equal(body.model,'openai/gpt-oss-120b');
  assert.equal(body.transcriptionModel,'nova-3');
  return new Response(JSON.stringify(videoResult()),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const result=await processVideo({remoteUrl:'https://cdn.example/video.mp4',model:'openai/gpt-oss-120b',transcriptionModel:'nova-3',guides:[{name:'Guía',text:'Objetivo\nProcedimiento',structure:['Objetivo','Procedimiento']}],onProgress:()=>{}});
 assert.equal(calls.length,1);
 assert.equal(result.transcript.actions.length,1);
 assert.equal(result.transcript.actions[0].action_id,'ACC-00001');
 assert.equal(result.transcript.actions[0].capture_timestamp,'00:11');
});
