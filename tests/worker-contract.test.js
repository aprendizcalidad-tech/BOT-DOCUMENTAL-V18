import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/worker.js';

const env={
  GROQ_API_KEY:'groq-secret',
  DEEPGRAM_API_KEY:'dg-secret',
  MEDIA_SIGNING_SECRET:'media-secret',
  APP_TOKEN:'app-secret',
  ALLOWED_ORIGINS:'https://usuario.github.io',
  B2_APPLICATION_KEY_ID:'b2-key-id',
  B2_APPLICATION_KEY:'b2-app-key',
  B2_BUCKET_ID:'bucket-123',
  B2_BUCKET_NAME:'bot-documental-videos',
  GROQ_MODEL:'openai/gpt-oss-120b',
  DEEPGRAM_MODEL:'nova-3'
};

function b2AuthResponse(){return {
  accountId:'account-1',
  authorizationToken:'account-token',
  apiInfo:{storageApi:{
    absoluteMinimumPartSize:5_000_000,
    recommendedPartSize:100_000_000,
    apiUrl:'https://api001.backblazeb2.com',
    downloadUrl:'https://f001.backblazeb2.com'
  }}
};}

function installB2Mock(extraHandler){
  const original=globalThis.fetch;
  const calls=[];
  globalThis.fetch=async(url,opts={})=>{
    const u=String(url);calls.push(u);
    if(extraHandler){const x=await extraHandler(u,opts,calls);if(x)return x;}
    if(u==='https://api.backblazeb2.com/b2api/v4/b2_authorize_account'){
      assert.match(new Headers(opts.headers).get('Authorization')||'',/^Basic /);
      return new Response(JSON.stringify(b2AuthResponse()),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(u.endsWith('/b2api/v4/b2_start_large_file')){
      const b=JSON.parse(opts.body);assert.equal(b.bucketId,'bucket-123');
      return new Response(JSON.stringify({fileId:'large-file-1',fileName:b.fileName}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(u.endsWith('/b2api/v4/b2_get_upload_part_url')){
      return new Response(JSON.stringify({uploadUrl:'https://upload.backblaze.test/part',authorizationToken:'upload-token'}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(u==='https://upload.backblaze.test/part'){
      const h=new Headers(opts.headers);assert.equal(h.get('Authorization'),'upload-token');assert.equal(h.get('X-Bz-Part-Number'),'1');
      const sha=h.get('X-Bz-Content-Sha1');assert.match(sha,/^[a-f0-9]{40}$/);
      return new Response(JSON.stringify({fileId:'large-file-1',partNumber:1,contentLength:5,contentSha1:sha}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(u.endsWith('/b2api/v4/b2_finish_large_file')){
      const b=JSON.parse(opts.body);assert.equal(b.fileId,'large-file-1');assert.equal(b.partSha1Array.length,1);
      return new Response(JSON.stringify({fileId:'large-file-1',fileName:'videos/test-video.mp4',contentLength:5,contentSha1:'none'}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(u.endsWith('/b2api/v4/b2_cancel_large_file')) return new Response(JSON.stringify({fileId:'large-file-1'}),{status:200,headers:{'Content-Type':'application/json'}});
    if(u.endsWith('/b2api/v4/b2_delete_file_version')) return new Response(JSON.stringify({fileId:'large-file-1'}),{status:200,headers:{'Content-Type':'application/json'}});
    throw new Error('URL inesperada '+u);
  };
  return {restore(){globalThis.fetch=original},calls};
}

test('Worker health expone Deepgram, Groq y Backblaze B2 sin filtrar secretos',async()=>{
  const response=await worker.fetch(new Request('https://worker.example/health',{headers:{Origin:'https://usuario.github.io'}}),env);
  assert.equal(response.status,200);const text=await response.text();
  assert.match(text,/groqConfigured/);assert.match(text,/deepgramConfigured/);assert.match(text,/b2Configured/);
  assert.doesNotMatch(text,/groq-secret|dg-secret|media-secret|b2-app-key/);
});

test('Worker crea y completa carga multipart en Backblaze B2',async()=>{
  const mock=installB2Mock();
  try{
    let res=await worker.fetch(new Request('https://worker.example/media/create',{method:'POST',headers:{Origin:'https://usuario.github.io','X-App-Token':'app-secret','Content-Type':'application/json'},body:JSON.stringify({name:'test-video.mp4',size:6_000_000,mimeType:'video/mp4'})}),env);
    const session=await res.json();assert.equal(res.status,200);assert.ok(session.key.startsWith('videos/'));assert.equal(session.uploadId,'large-file-1');
    res=await worker.fetch(new Request('https://worker.example/media/part',{method:'POST',headers:{Origin:'https://usuario.github.io','X-App-Token':'app-secret','X-Upload-Key':session.key,'X-Upload-Id':session.uploadId,'X-Part-Number':'1','Content-Length':'5'},body:new Uint8Array([1,2,3,4,5])}),env);
    const part=await res.json();assert.match(part.sha1,/^[a-f0-9]{40}$/);
    res=await worker.fetch(new Request('https://worker.example/media/complete',{method:'POST',headers:{Origin:'https://usuario.github.io','X-App-Token':'app-secret','Content-Type':'application/json'},body:JSON.stringify({key:session.key,uploadId:session.uploadId,parts:[part]})}),env);
    const done=await res.json();assert.equal(res.status,200);assert.equal(done.fileId,'large-file-1');assert.equal(done.storage,'Backblaze B2');
  }finally{mock.restore();}
});

test('Video analyze llama Deepgram y Groq y mantiene timestamps sin Gemini',async()=>{
  const mock=installB2Mock(async(u,opts)=>{
    if(u.startsWith('https://api.deepgram.com/v1/listen')){
      assert.equal(new Headers(opts.headers).get('Authorization'),'Token dg-secret');
      const b=JSON.parse(opts.body);assert.match(b.url,/worker\.example\/media\/file/);
      return new Response(JSON.stringify({metadata:{duration:120},results:{utterances:[{start:10,end:12,transcript:'Seleccionamos el botón Guardar y queda registrado.'}],channels:[{detected_language:'es',alternatives:[{transcript:'Seleccionamos el botón Guardar y queda registrado.'}]}]}}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    if(u==='https://api.groq.com/openai/v1/chat/completions'){
      assert.equal(new Headers(opts.headers).get('Authorization'),'Bearer groq-secret');
      const payload=JSON.parse(opts.body);const user=payload.messages[1].content;
      let content;
      if(user.startsWith('Extrae TODAS'))content={summary:'Se guarda un registro.',uncertainties:[],actions:[{action:'Selecciona Guardar',start_seconds:10,end_seconds:12,system:'Sistema',location_path:'Formulario',interface_element:'Guardar',result:'Registro guardado',uncertainty:'',capture_recommended:true,capture_seconds:11,capture_reason:'Tomar captura del guardado'}]};
      else content={document_analysis:{detected_process:'Prueba',selected_guide_index:0,selection_reason:'Coincide',proposed_document_title:'Procedimiento',supporting_guide_indices:[],general_requirements:[],sections:[{order:1,title:'Procedimiento',guide_instruction:'Documentar',criteria:['Trazabilidad'],required:true,status:'completo',evidence:['Video'],draft_content:'',missing_questions:[]}],warnings:[]},document_draft:{title:'Procedimiento',subtitle:'',introductory_note:'',sections:[{order:1,title:'Procedimiento',paragraphs:[],bullets:[],numbered_items:[],tables:[],source_basis:['Video']}],warnings:[]}};
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(content)}}]}),{status:200,headers:{'Content-Type':'application/json'}});
    }
    return null;
  });
  try{
    const request=new Request('https://worker.example/video/analyze',{method:'POST',headers:{Origin:'https://usuario.github.io','X-App-Token':'app-secret','Content-Type':'application/json'},body:JSON.stringify({key:'videos/test.mp4',fileId:'large-file-1',model:'openai/gpt-oss-120b',transcriptionModel:'nova-3',guides:[{name:'Guía',structure:['Procedimiento'],text:'Procedimiento'}],deleteAfter:false})});
    const response=await worker.fetch(request,env);const data=await response.json();
    assert.equal(response.status,200);assert.equal(data.actions.length,1);assert.equal(data.actions[0].capture_timestamp,'00:11');assert.equal(data.coverage.complete,true);
    assert.ok(mock.calls.some(x=>x.includes('api.deepgram.com')));assert.ok(mock.calls.some(x=>x.includes('api.groq.com')));assert.ok(mock.calls.every(x=>!x.includes('generativelanguage.googleapis.com')));
  }finally{mock.restore();}
});

test('Worker bloquea origen y token incorrectos',async()=>{
  const badOrigin=await worker.fetch(new Request('https://worker.example/health',{headers:{Origin:'https://evil.example'}}),env);assert.equal(badOrigin.status,403);
  const badToken=await worker.fetch(new Request('https://worker.example/chat',{method:'POST',headers:{Origin:'https://usuario.github.io','X-App-Token':'incorrecto','Content-Type':'application/json'},body:'{}'}),env);assert.equal(badToken.status,401);
});
