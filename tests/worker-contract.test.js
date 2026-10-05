import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/worker.js';

const env={GEMINI_API_KEY:'secret-key',APP_TOKEN:'app-secret',ALLOWED_ORIGINS:'https://usuario.github.io'};

test('Worker health expone estado pero nunca la API key',async()=>{
 const response=await worker.fetch(new Request('https://worker.example/health',{headers:{Origin:'https://usuario.github.io'}}),env);
 assert.equal(response.status,200);
 const text=await response.text();
 assert.match(text,/geminiConfigured/);
 assert.doesNotMatch(text,/secret-key/);
});

test('Worker crea análisis agentic de YouTube en streaming sin background polling',async()=>{
 const original=globalThis.fetch;let captured;
 globalThis.fetch=async(url,opts)=>{
  captured={url:String(url),opts,body:JSON.parse(opts.body)};
  const sse=[
   'event: interaction.created',
   'data: {"event_type":"interaction.created","interaction":{"id":"v1_prueba","status":"in_progress"}}',
   '',
   'event: step.delta',
   'data: {"event_type":"step.delta","delta":{"type":"text","text":"{}"}}',
   '',
   'event: interaction.completed',
   'data: {"event_type":"interaction.completed","interaction":{"id":"v1_prueba","status":"completed"}}',
   '',
   'event: done',
   'data: [DONE]',
   ''
  ].join('\n');
  return new Response(sse,{status:200,headers:{'Content-Type':'text/event-stream'}});
 };
 try{
  const request=new Request('https://worker.example/video/stream',{method:'POST',headers:{Origin:'https://usuario.github.io','X-App-Token':'app-secret','Content-Type':'application/json'},body:JSON.stringify({youtubeUrl:'https://www.youtube.com/watch?v=abc123',model:'gemini-3.8-flash',guides:[{name:'Procedimiento institucional.docx',structure:['Objetivo','Alcance','Procedimiento'],text:'Objetivo\nAlcance\nProcedimiento'}]})});
  const response=await worker.fetch(request,env);const text=await response.text();
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-type'),/text\/event-stream/i);
  assert.match(text,/interaction\.completed/);
  assert.match(captured.url,/\/v1beta\/interactions\?alt=sse$/);
  assert.equal(captured.body.stream,true);
  assert.equal(captured.body.background,undefined);
  assert.equal(captured.body.input[0].type,'video');
  assert.equal(captured.body.input[0].processing,'agentic');
  assert.equal(captured.body.response_format.mime_type,'application/json');
  const actionProps=captured.body.response_format.schema.properties.actions.items.properties;
  assert.ok(actionProps.capture_timestamp);assert.ok(actionProps.capture_seconds);assert.ok(actionProps.capture_recommended);assert.ok(actionProps.capture_reason);
  assert.ok(captured.body.response_format.schema.properties.document_analysis);
  assert.ok(captured.body.response_format.schema.properties.document_draft);
  assert.match(captured.body.input[1].text,/NO extraigas, generes ni devuelvas imágenes/i);
  assert.match(captured.body.input[1].text,/MODO AHORRO DE CUOTA/i);
  assert.match(captured.body.input[1].text,/Procedimiento institucional\.docx/i);
  const hs=new Headers(captured.opts.headers);
  assert.equal(hs.get('x-goog-api-key'),'secret-key');
  assert.equal(hs.get('authorization'),null);
 }finally{globalThis.fetch=original;}
});

test('Files API inicia carga usando solo x-goog-api-key',async()=>{
 const original=globalThis.fetch;let captured;
 globalThis.fetch=async(url,opts)=>{
  captured={url:String(url),headers:new Headers(opts.headers)};
  return new Response('',{status:200,headers:{'x-goog-upload-url':'https://generativelanguage.googleapis.com/upload/session123'}});
 };
 try{
  const request=new Request('https://worker.example/files/start',{method:'POST',headers:{Origin:'https://usuario.github.io','X-App-Token':'app-secret','Content-Type':'application/json'},body:JSON.stringify({name:'video.mp4',mimeType:'video/mp4',size:12345})});
  const response=await worker.fetch(request,env);const data=await response.json();
  assert.equal(response.status,200);assert.equal(data.ok,true);
  assert.equal(captured.url,'https://generativelanguage.googleapis.com/upload/v1beta/files');
  assert.equal(captured.headers.get('x-goog-api-key'),'secret-key');
  assert.equal(captured.headers.get('authorization'),null);
  assert.ok(!captured.url.includes('?key='));
 }finally{globalThis.fetch=original;}
});

test('Worker bloquea origen y token incorrectos',async()=>{
 const badOrigin=await worker.fetch(new Request('https://worker.example/health',{headers:{Origin:'https://evil.example'}}),env);
 assert.equal(badOrigin.status,403);
 const badToken=await worker.fetch(new Request('https://worker.example/chat',{method:'POST',headers:{Origin:'https://usuario.github.io','X-App-Token':'incorrecto','Content-Type':'application/json'},body:'{}'}),env);
 assert.equal(badToken.status,401);
});
