import test from 'node:test';
import assert from 'node:assert/strict';
import {setCloudConfig} from '../js/cloud-api.js';
import {localJSON,analyzeLocal,generateDraftLocal,regenerateSection,auditLocal} from '../js/local-ai.js';

const memory=new Map();
globalThis.indexedDB={open(){const r={};queueMicrotask(()=>{r.result={objectStoreNames:{contains:()=>true},close(){},transaction(){const tx={};tx.objectStore=()=>({get(key){const q={};queueMicrotask(()=>{q.result=memory.get(key);q.onsuccess?.();tx.oncomplete?.()});return q},put(value,key){memory.set(key,value);queueMicrotask(()=>tx.oncomplete?.())}});return tx;}};r.onsuccess?.()});return r;}};

setCloudConfig({backendUrl:'https://example.workers.dev',appToken:'token-prueba'});

test('Flujo cloud usa backend seguro y conserva acciones ACC al regenerar',async()=>{
 const requests=[];
 globalThis.fetch=async(url,opts={})=>{
  assert.equal(url,'https://example.workers.dev/chat');
  assert.equal(new Headers(opts.headers).get('X-App-Token'),'token-prueba');
  const body=JSON.parse(opts.body);requests.push(body);let value;
  if(body.prompt.startsWith('Actúa como analista documental'))value={selected_guide_index:0,proposed_document_title:'Procedimiento',sections:[{title:'PASOS',order:1,criteria:[]}],warnings:[]};
  else if(body.prompt.startsWith('Redacta el documento completo'))value={title:'Procedimiento',sections:[{order:1,title:'PASOS',paragraphs:['Contenido sustentado'],numbered_items:[],tables:[],source_basis:['Origen']}]};
  else if(body.prompt.startsWith('Audita el documento completo'))value={validation:[{section_title:'PASOS',criterion:'Trazabilidad',status:'parcial',note:'Revisar'}],warnings:[],editorial_summary:'OK'};
  else value={paragraphs:['Contenido regenerado'],numbered_items:[],tables:[],source_basis:['Origen']};
  return new Response(JSON.stringify(value),{status:200,headers:{'Content-Type':'application/json'}});
 };
 const guides=[{name:'Guía',text:'PASOS\nDocumentar cada acción.',structure:[{order:1,title:'PASOS'}]}],source={text:'El usuario abre el sistema.'},model='openai/gpt-oss-120b';
 const analysis=await analyzeLocal({model,guides,source});
 const doc=await generateDraftLocal({model,guides,source,analysis,answers:[]});
 doc.sections[0].numbered_items=['[ACC-00001] Abrir sistema'];
 const sec=await regenerateSection({model,guides,source,analysis,answers:[],document:doc,sectionOrder:1});
 assert.deepEqual(sec.numbered_items,doc.sections[0].numbered_items);
 assert.equal((await auditLocal({model,guides,source,analysis,document:doc})).validation.length,1);
 assert.ok(requests.every(r=>!('apiKey' in r)&&r.model===model));
});

test('Un error del Worker no se interpreta como documento',async()=>{
 globalThis.fetch=async()=>new Response(JSON.stringify({ok:false,error:'Groq no disponible'}),{status:400,headers:{'Content-Type':'application/json'}});
 await assert.rejects(()=>localJSON('openai/gpt-oss-120b','prompt'),/Groq no disponible/);
});
