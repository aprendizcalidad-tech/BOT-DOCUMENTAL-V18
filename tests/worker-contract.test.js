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

test('Worker crea análisis agentic de YouTube en background',async()=>{
 const original=globalThis.fetch;let captured;
 globalThis.fetch=async(url,opts)=>{captured={url:String(url),opts,body:JSON.parse(opts.body)};return new Response(JSON.stringify({id:'v1_prueba',status:'in_progress'}),{status:200,headers:{'Content-Type':'application/json'}})};
 try{
  const request=new Request('https://worker.example/video/start',{method:'POST',headers:{Origin:'https://usuario.github.io','X-App-Token':'app-secret','Content-Type':'application/json'},body:JSON.stringify({youtubeUrl:'https://www.youtube.com/watch?v=abc123',model:'gemini-3.7-flash'})});
  const response=await worker.fetch(request,env);const data=await response.json();
  assert.equal(response.status,200);assert.equal(data.id,'v1_prueba');
  assert.equal(captured.body.background,true);
  assert.equal(captured.body.input[0].type,'video');
  assert.equal(captured.body.input[0].processing,'agentic');
  assert.equal(captured.body.response_format.mime_type,'application/json');
  const actionProps=captured.body.response_format.schema.properties.actions.items.properties;
  assert.ok(actionProps.capture_timestamp);assert.ok(actionProps.capture_seconds);assert.ok(actionProps.capture_recommended);assert.ok(actionProps.capture_reason);
  assert.match(captured.body.input[1].text,/NO extraigas, generes ni devuelvas imágenes/i);
  assert.equal(new Headers(captured.opts.headers).get('x-goog-api-key'),'secret-key');
 }finally{globalThis.fetch=original;}
});

test('Worker bloquea origen y token incorrectos',async()=>{
 const badOrigin=await worker.fetch(new Request('https://worker.example/health',{headers:{Origin:'https://evil.example'}}),env);
 assert.equal(badOrigin.status,403);
 const badToken=await worker.fetch(new Request('https://worker.example/chat',{method:'POST',headers:{Origin:'https://usuario.github.io','X-App-Token':'incorrecto','Content-Type':'application/json'},body:'{}'}),env);
 assert.equal(badToken.status,401);
});
