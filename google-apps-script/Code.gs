/* Xpanzia Group — Backend privado. NO poner datos reales en el repositorio. */
const TABLES = ['Users','Courses','Enrollments','Attempts','Certificates','Routes','Settings','Auth','Sessions','Invitations','Schools'];
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
// Request-scoped cache only: no private data shared between requests.
let requestDb_=null, requestTables_=Object.create(null);
function resetRequest_(){requestDb_=null;requestTables_=Object.create(null);}
function db_(){if(!requestDb_){const id=prop_('SPREADSHEET_ID');if(!id)throw Error('Ejecuta instalar() primero.');requestDb_=SpreadsheetApp.openById(id);}return requestDb_;}
function table_(name){
 if(!requestTables_[name]){const sheet=db_().getSheetByName(name);need_(sheet,'Falta la tabla '+name+'. Ejecuta actualizarCampusV3 en Apps Script.');const last=sheet.getLastRow(),rows=[],positions=new Map();
  if(last>1)sheet.getRange(2,1,last-1,2).getValues().forEach((r,i)=>{if(r[0]){const obj=JSON.parse(r[1]);positions.set(String(r[0]),i+2);rows.push(obj);}});
  requestTables_[name]={sheet,rows,positions,last};
 }return requestTables_[name];
}
function rows_(name){return table_(name).rows;}
function get_(name,id){return rows_(name).find(x=>x.id===id);}
function put_(name,obj){const serialized=JSON.stringify(obj);if(serialized.length>45000)throw Error('Registro demasiado extenso. Divide el contenido en cursos más pequeños.');const t=table_(name),row=t.positions.get(obj.id)||t.last+1;t.sheet.getRange(row,1,1,2).setValues([[obj.id,serialized]]);const i=t.rows.findIndex(x=>x.id===obj.id);if(i<0)t.rows.push(obj);else t.rows[i]=obj;t.positions.set(obj.id,row);t.last=Math.max(t.last,row);return obj;}
function uid_(){return Utilities.getUuid().replace(/-/g,'');}
function hash_(s){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function now_(){return new Date().toISOString();}
function need_(yes,msg){if(!yes)throw Error(msg);}
function txt_(v,max){return String(v==null?'':v).trim().slice(0,max||300);}
function email_(v){const e=txt_(v,254).toLowerCase();need_(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),'Correo inválido.');return e;}
function settings_(){return get_('Settings','main')||{id:'main',company:'Xpanzia Group',signer:'Xpanzia Group',portalUrl:'',privacy:'Contacta a Gestión Humana para consultar la política de tratamiento de datos.',maxAttempts:5};}
function admin_(u){need_(u&&u.role==='admin','Esta acción requiere un administrador.');}
function user_(token){need_(typeof token==='string'&&token.length>30,'Inicia sesión para continuar.');const s=get_('Sessions',hash_(token));need_(s&&s.expires>Date.now(),'La sesión venció. Vuelve a ingresar.');const u=get_('Users',s.userId);need_(u&&u.active!==false,'Usuario inactivo.');u.role=prop_('ADMIN_EMAILS').split(',').map(x=>x.trim().toLowerCase()).includes(u.email)?'admin':'student';return u;}
function publicCourse_(c){return {...courseSchool_(c),quiz:(c.quiz||[]).map(q=>({id:q.id,text:q.text,options:q.options}))};}
function allowed_(email){return prop_('ADMIN_EMAILS').split(',').map(x=>x.trim().toLowerCase()).includes(email)||rows_('Invitations').some(x=>x.email===email&&x.active!==false)||prop_('ALLOWED_DOMAINS').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean).includes(email.split('@')[1]);}
function doGet(){return ContentService.createTextOutput(JSON.stringify({ok:true,service:'Universidad Xpanzia Group',version:'1.0'})).setMimeType(ContentService.MimeType.JSON);}
function doPost(e){resetRequest_();let result,changesCatalog=false;const lock=LockService.getScriptLock();try{
 need_(e&&e.postData&&e.postData.contents.length<180000,'Solicitud inválida.');const req=JSON.parse(e.postData.contents);
 if(!['catalog','me','adminData','verifyCertificate','downloadCertificate','bootstrap'].includes(req.action)){if(!lock.tryLock(150)){const busy=Error('Hay otros guardados en curso. Reintentando…');busy.code='BUSY';throw busy;}}
 const affectsCatalog=['saveCourse','saveRoute','saveSettings','saveSchool','deleteSchool'].includes(req.action);if(affectsCatalog){admin_(user_(req.token));changesCatalog=true;invalidateCatalog_();}
 result={ok:true,data:dispatch_(req)};
 }catch(err){result={ok:false,error:err.message||'No fue posible completar la solicitud.',code:err.code||'ERROR'};}
 finally{if(changesCatalog)invalidateCatalog_();if(lock.hasLock())lock.releaseLock();}
 return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function dispatch_(r){const a=r.action,p=r.payload||{};
 if(a==='catalog')return cachedCatalog_();
 if(a==='bootstrap'){const catalog=cachedCatalog_();if(!r.token)return {catalog,me:null};return {catalog,me:dispatch_({...r,action:'me'})};}
 if(a==='requestCode'){
  const email=email_(p.email), key=hash_(email), old=get_('Auth',key), day=now_().slice(0,10);
  need_(!old||Date.now()-old.created>60000,'Espera un minuto antes de solicitar otro código.');
  need_(!old||old.day!==day||old.sent<8,'Alcanzaste el límite diario de códigos.');
  const id=uid_(), code=String(parseInt(uid_().slice(0,12),16)%100000000).padStart(8,'0');
  const eligible=allowed_(email); const record={id:key,challenge:id,email,code:hash_(id+code),created:Date.now(),expires:Date.now()+600000,tries:0,used:false,day,sent:old&&old.day===day?old.sent+1:1,eligible};
  put_('Auth',record);
  if(eligible){need_(MailApp.getRemainingDailyQuota()>0,'El envío de correos está temporalmente agotado. Contacta al administrador.');MailApp.sendEmail(email,'Xpanzia Group: tu código de acceso', 'Tu código es: '+code+'\nVence en 10 minutos. No lo compartas. Si no lo solicitaste, ignora este mensaje.');}
  return {challenge:id,message:'Si tu correo está autorizado, recibirás un código válido por 10 minutos.'};
 }
 if(a==='verifyCode'){
  const email=email_(p.email),c=get_('Auth',hash_(email));need_(c&&!c.used&&c.expires>Date.now()&&c.tries<5&&c.challenge===p.challenge,'Código vencido o inválido. Solicita uno nuevo.');c.tries++;put_('Auth',c);
  need_(c.eligible&&c.code===hash_(c.challenge+txt_(p.code)),'Código incorrecto.');c.used=true;put_('Auth',c);
  let u=rows_('Users').find(x=>x.email===email);if(!u)u=put_('Users',{id:uid_(),email,name:'',active:true,created:now_()});need_(u.active!==false,'Usuario inactivo.');
  const token=uid_()+uid_();put_('Sessions',{id:hash_(token),userId:u.id,expires:Date.now()+12*3600000});return {token,user:user_(token)};
 }
 if(a==='verifyCertificate'){const code=txt_(p.code,80).toUpperCase();need_(/^UC-\d{4}-[A-F0-9]{16}$/.test(code),'Ingresa un código de certificado válido.');const c=rows_('Certificates').find(x=>x.code===code);need_(c,'No encontramos este certificado.');return {code:c.code,name:c.name,title:c.title,hours:c.hours,date:c.date,revoked:!!c.revoked,company:c.company};}
 const u=user_(r.token);
 if(a==='logout'){const s=get_('Sessions',hash_(r.token));s.expires=0;put_('Sessions',s);return true;}
 if(a==='me')return {user:u,enrollments:rows_('Enrollments').filter(x=>x.userId===u.id),attempts:rows_('Attempts').filter(x=>x.userId===u.id),certificates:rows_('Certificates').filter(x=>x.userId===u.id)};
 if(a==='saveProfile'){need_(p.consent===true,'Acepta el tratamiento de datos para continuar.');for(const k of ['name','document','company','area','position','city']){need_(txt_(p[k]),'Completa todos los datos del perfil.');u[k]=txt_(p[k],k==='document'?30:150);}u.consentAt=now_();put_('Users',u);return u;}
 if(a==='enroll'){need_(/^https:\/\//.test(settings_().portalUrl||''),'El administrador debe configurar la dirección pública del campus antes de abrir las inscripciones.');need_(u.name&&u.consentAt,'Completa tu perfil primero.');const c=get_('Courses',p.courseId);need_(c&&c.published,'Curso no disponible.');const id=u.id+'_'+c.id;return get_('Enrollments',id)||put_('Enrollments',{id,userId:u.id,courseId:c.id,completed:[],date:now_()});}
 if(a==='completeLesson'){const c=get_('Courses',p.courseId),e=get_('Enrollments',u.id+'_'+p.courseId);need_(c&&c.published&&e,'Inscríbete primero.');need_(c.lessons.some(l=>l.id===p.lessonId),'Lección inválida.');if(!e.completed.includes(p.lessonId))e.completed.push(p.lessonId);e.updated=now_();return put_('Enrollments',e);}
 if(a==='submitQuiz'){
  const prior=get_('Attempts',txt_(p.requestId,80));if(prior){need_(prior.userId===u.id&&prior.courseId===p.courseId,'Solicitud inválida.');return prior;}
  need_(/^[a-f0-9-]{20,80}$/.test(p.requestId||''),'Identificador inválido.');const c=get_('Courses',p.courseId),e=get_('Enrollments',u.id+'_'+p.courseId);
  need_(c&&c.published&&e,'Curso no disponible o sin inscripción.');need_(c.lessons.every(l=>e.completed.includes(l.id)),'Completa todas las lecciones antes de evaluar.');
  const attempts=rows_('Attempts').filter(x=>x.userId===u.id&&x.courseId===c.id);need_(!attempts.some(x=>x.passed),'Ya aprobaste este curso.');need_(attempts.filter(x=>x.date.slice(0,10)===now_().slice(0,10)).length<settings_().maxAttempts,'Alcanzaste el máximo de intentos de hoy (UTC).');
  need_(Array.isArray(p.answers)&&p.answers.length===c.quiz.length,'Responde todas las preguntas.');let correct=0;c.quiz.forEach((q,i)=>{need_(Number.isInteger(p.answers[i])&&p.answers[i]>=0&&p.answers[i]<q.options.length,'Respuesta inválida.');if(p.answers[i]===q.correct)correct++;});
  const score=Math.round(correct*100/c.quiz.length);const attempt={id:p.requestId,userId:u.id,courseId:c.id,courseTitle:c.title,score,passed:score>=c.passScore,date:now_(),answers:p.answers,courseVersion:c.updated||c.id};put_('Attempts',attempt);
  if(attempt.passed)ensureCertificates_(u);return attempt;
 }
 if(a==='downloadCertificate'){const c=get_('Certificates',p.id);need_(c&&c.userId===u.id&&!c.revoked,'Certificado no disponible.');if(certificateNeedsPdf_(c))return {pending:true,message:'Tu PDF se está preparando automáticamente. Vuelve a descargarlo en unos minutos.'};const blob=DriveApp.getFileById(c.fileId).getBlob();return {filename:c.code+'.pdf',base64:Utilities.base64Encode(blob.getBytes())};}
 if(a==='adminData'){admin_(u);return {users:rows_('Users'),schools:schools_(),courses:rows_('Courses').map(courseSchool_),routes:rows_('Routes'),enrollments:rows_('Enrollments'),attempts:rows_('Attempts'),certificates:rows_('Certificates'),settings:settings_(),invitations:rows_('Invitations')};}
 if(a==='saveSchool'){admin_(u);return saveSchool_(p);}
 if(a==='deleteSchool'){admin_(u);return deleteSchool_(p);}
 if(a==='saveCourse'){admin_(u);const c=validateCourse_(p);const old=get_('Courses',c.id);if(old)need_(p.updated===old.updated,'Otra persona actualizó el curso. Recarga antes de guardar.');if(old&&rows_('Enrollments').some(e=>e.courseId===c.id)){need_(JSON.stringify(old.lessons)===JSON.stringify(c.lessons)&&JSON.stringify(old.quiz)===JSON.stringify(c.quiz)&&old.passScore===c.passScore,'Este curso tiene inscripciones. Duplica el curso para cambiar lecciones, preguntas o nota mínima.');}return put_('Courses',c);}
 if(a==='saveRoute'){admin_(u);const ids=[...new Set(p.courseIds||[])];need_(txt_(p.title)&&ids.length,'Indica nombre y cursos de la ruta.');need_(ids.every(id=>get_('Courses',id)),'Hay cursos inexistentes.');const old=get_('Routes',p.id);need_(!old||!rows_('Certificates').some(c=>c.routeId===old.id)||JSON.stringify(old.courseIds)===JSON.stringify(ids),'Esta ruta ya tiene certificados. Crea una nueva para cambiar sus cursos.');const rt=put_('Routes',{id:p.id||uid_(),title:txt_(p.title,150),description:txt_(p.description,1500),courseIds:ids,published:!!p.published});return rt;}
 if(a==='saveSettings'){admin_(u);const url=txt_(p.portalUrl,500);need_(/^https:\/\//.test(url),'La dirección del portal debe comenzar por https://.');need_(+p.maxAttempts>=1&&+p.maxAttempts<=20,'Usa entre 1 y 20 intentos diarios.');return put_('Settings',{id:'main',company:txt_(p.company,150),signer:txt_(p.signer,150),portalUrl:url,privacy:txt_(p.privacy,5000),maxAttempts:Math.floor(+p.maxAttempts)});}
 if(a==='invite'){admin_(u);const emails=String(p.emails||'').split(/[\s,;]+/).filter(Boolean);need_(emails.length<=100,'Invita hasta 100 correos por operación.');emails.forEach(v=>{const email=email_(v);put_('Invitations',{id:hash_(email),email,active:true});});return {count:emails.length};}
 if(a==='setUserActive'){admin_(u);need_(p.id!==u.id,'No puedes desactivar tu propia cuenta.');const target=get_('Users',p.id);need_(target,'Usuario inexistente.');target.active=!!p.active;return put_('Users',target);}
 if(a==='revokeCertificate'){admin_(u);const c=get_('Certificates',p.id);need_(c,'Certificado inexistente.');c.revoked=true;c.revokedAt=now_();return put_('Certificates',c);}
 if(a==='retryMail'){admin_(u);const c=get_('Certificates',p.id);need_(c&&!c.revoked,'Certificado no disponible.');need_(c.mailStatus!=='sent','El correo ya fue enviado.');c.nextTry=0;put_('Certificates',c);return true;}
 throw Error('Acción no reconocida.');
}
function validateCourse_(p){const school=schools_().find(s=>p.schoolId?s.id===p.schoolId:s.name===p.school);need_(school,'Selecciona una escuela existente.');const c={id:txt_(p.id)||uid_(),title:txt_(p.title,150),schoolId:school.id,school:school.name,image:imageValue_(p.image),description:txt_(p.description,2500),hours:+p.hours,level:txt_(p.level,50)||'Básico',passScore:+p.passScore,published:!!p.published,lessons:p.lessons,quiz:p.quiz,updated:now_()};need_(c.title&&c.school&&c.hours>0&&c.hours<=1000&&c.passScore>=1&&c.passScore<=100,'Revisa nombre, escuela, duración y nota.');need_(Array.isArray(c.lessons)&&c.lessons.length>0&&c.lessons.length<=30,'Incluye entre 1 y 30 lecciones.');c.lessons=c.lessons.map(l=>{need_(txt_(l.title)&&txt_(l.body),'Cada lección requiere título y contenido.');const url=txt_(l.url,1000);need_(!url||/^https:\/\//i.test(url),'Los recursos deben usar https://.');return {id:txt_(l.id)||uid_(),title:txt_(l.title,150),body:txt_(l.body,12000),url,type:txt_(l.type,30)||'Lectura'};});need_(new Set(c.lessons.map(l=>l.id)).size===c.lessons.length,'Identificadores de lección repetidos.');need_(Array.isArray(c.quiz)&&c.quiz.length>0&&c.quiz.length<=50,'Incluye entre 1 y 50 preguntas.');c.quiz=c.quiz.map(q=>{need_(txt_(q.text)&&Array.isArray(q.options)&&q.options.length>=2&&q.options.length<=6&&q.options.every(x=>txt_(x))&&Number.isInteger(+q.correct)&&+q.correct>=0&&+q.correct<q.options.length,'Revisa preguntas, opciones y respuestas correctas.');return {id:txt_(q.id)||uid_(),text:txt_(q.text,1000),options:q.options.map(x=>txt_(x,500)),correct:+q.correct};});return c;}
function ensureCertificates_(u){const passed=rows_('Attempts').filter(a=>a.userId===u.id&&a.passed);passed.forEach(a=>{const c=get_('Courses',a.courseId);if(c)issue_(u,'course',c,a.date);});const ids=passed.map(x=>x.courseId);rows_('Routes').filter(r=>r.published&&r.courseIds.length&&r.courseIds.every(id=>ids.includes(id))).forEach(r=>issue_(u,'route',{...r,hours:r.courseIds.reduce((n,id)=>n+(get_('Courses',id)||{hours:0}).hours,0)},now_()));}
function issue_(u,type,item,date){const id=u.id+'_'+type+'_'+item.id;if(get_('Certificates',id))return;const s=settings_();put_('Certificates',{id,userId:u.id,courseId:type==='course'?item.id:'',routeId:type==='route'?item.id:'',code:'UC-'+new Date().getFullYear()+'-'+uid_().slice(0,16).toUpperCase(),title:item.title,hours:item.hours,name:u.name,email:u.email,company:s.company,signer:s.signer,portalUrl:s.portalUrl,date,fileId:'',mailStatus:'pending',tries:0,nextTry:0,revoked:false});}
function generatePdf_(c){return generatePremiumPdf_(c);}
// Release the shared write lock between certificates; reports never block students.
function workerWrite_(work){const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return false;try{resetRequest_();work();return true;}finally{lock.releaseLock();}}
function procesarPendientes(){
 const started=Date.now(),owner=uid_();let owns=false;
 if(!workerWrite_(()=>{const lease=JSON.parse(prop_('WORKER_LEASE_V3')||'null');if(lease&&lease.until>Date.now())return;PropertiesService.getScriptProperties().setProperty('WORKER_LEASE_V3',JSON.stringify({owner,until:Date.now()+420000}));owns=true;} )||!owns)return;
 try{
  resetRequest_();const certificates=rows_('Certificates'),existing=new Set(certificates.map(c=>c.id)),passed=rows_('Attempts').filter(a=>a.passed),routes=rows_('Routes').filter(r=>r.published),users=rows_('Users').filter(u=>u.name&&u.active!==false);
  const recovery=users.filter(u=>{const mine=passed.filter(a=>a.userId===u.id),ids=new Set(mine.map(a=>a.courseId));return mine.some(a=>!existing.has(u.id+'_course_'+a.courseId))||routes.some(r=>r.courseIds.length&&r.courseIds.every(id=>ids.has(id))&&!existing.has(u.id+'_route_'+r.id));}).map(u=>u.id);
  for(const id of recovery){if(Date.now()-started>180000)return;if(!workerWrite_(()=>{const u=get_('Users',id);if(u&&u.active!==false)ensureCertificates_(u);}))return;}
  resetRequest_();const queue=rows_('Certificates').filter(c=>!c.revoked&&(certificateNeedsPdf_(c)||c.mailStatus!=='sent')&&(!c.nextTry||c.nextTry<Date.now())).slice(0,100).map(c=>c.id);
  for(const id of queue){if(Date.now()-started>200000)break;
   resetRequest_();let c=get_('Certificates',id);if(!c||c.revoked)continue;
   try{
    if(certificateNeedsPdf_(c)){
     // Slides/Drive export is deliberately OUTSIDE the shared write lock.
     const built=generatePremiumPdf_(c,false);need_(built&&built.fileId,'Actualiza Certificate.gs con la misma versión de Code.gs. El generador no devolvió el PDF.');let accepted=false;
     const saved=workerWrite_(()=>{const current=get_('Certificates',id);if(!current||current.revoked)return;put_('Certificates',{...current,fileId:built.fileId,designVersion:built.designVersion});accepted=true;});
     if(!saved||!accepted){DriveApp.getFileById(built.fileId).setTrashed(true);continue;}
    }
    resetRequest_();c=get_('Certificates',id);if(!c||c.revoked||c.mailStatus==='sent')continue;
    if(MailApp.getRemainingDailyQuota()<1)continue;
    // Keep the delivery state and send under a short critical section to avoid a revocation/send race.
    if(!workerWrite_(()=>{const current=get_('Certificates',id);if(!current||current.revoked||current.mailStatus==='sent')return;MailApp.sendEmail({to:current.email,subject:'Xpanzia Group: tu certificado de '+current.title,body:'Hola '+current.name+',\n\nAprobaste '+current.title+'. Adjuntamos tu certificado.\nCódigo: '+current.code+'\nVerificación: '+current.portalUrl.replace(/#.*$/,'')+'#verificar/'+current.code,attachments:[DriveApp.getFileById(current.fileId).getBlob()]});put_('Certificates',{...current,mailStatus:'sent',sentAt:now_(),error:'',nextTry:0});}))break;
   }catch(err){console.error('Certificado '+id+': '+(err.message||err));workerWrite_(()=>{const current=get_('Certificates',id);if(!current||current.revoked)return;const tries=(current.tries||0)+1;put_('Certificates',{...current,mailStatus:current.mailStatus==='sent'?'sent':'error',tries,error:txt_(err.message,1000),nextTry:Date.now()+Math.min(1440,Math.pow(2,tries)*5)*60000});});}
  }
  resetRequest_();actualizarReportes_();
  workerWrite_(()=>{for(const name of ['Auth','Sessions']){const t=table_(name);const expired=t.rows.filter(r=>r.expires<Date.now()-86400000).map(r=>t.positions.get(r.id)).sort((a,b)=>b-a);expired.forEach(row=>t.sheet.deleteRow(row));delete requestTables_[name];}});
 }finally{workerWrite_(()=>{const lease=JSON.parse(prop_('WORKER_LEASE_V3')||'null');if(lease&&lease.owner===owner)PropertiesService.getScriptProperties().setProperty('WORKER_LEASE_V3','');});}
}
function instalar(){resetRequest_();const p=PropertiesService.getScriptProperties();need_(prop_('ADMIN_EMAILS'),'Configura ADMIN_EMAILS en Propiedades de la secuencia de comandos.');let db;if(prop_('SPREADSHEET_ID'))db=db_();else{db=SpreadsheetApp.create('Xpanzia Group — Base de datos');p.setProperty('SPREADSHEET_ID',db.getId());}TABLES.forEach(t=>{if(!db.getSheetByName(t))db.insertSheet(t).appendRow(['id','data_json']).setFrozenRows(1);});if(!prop_('CERTIFICATE_FOLDER_ID'))p.setProperty('CERTIFICATE_FOLDER_ID',DriveApp.createFolder('Xpanzia Group — Certificados privados').getId());if(!get_('Settings','main'))put_('Settings',settings_());if(!rows_('Courses').length)put_('Courses',seedCourse_());if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='procesarPendientes'))ScriptApp.newTrigger('procesarPendientes').timeBased().everyMinutes(5).create();console.log('Instalación lista. Base de datos: '+db.getUrl());}
function sheetText_(v){if(typeof v==='number'||typeof v==='boolean')return v;const s=String(v==null?'':v);return /^[\s]*[=+@\-\t\r]/.test(s)?"'"+s:s;}
function writeReport_(name,headers,values){const db=db_(),s=db.getSheetByName(name)||db.insertSheet(name);s.clearContents();s.getRange(1,1,1,headers.length).setValues([headers]).setBackground('#142c4c').setFontColor('#ffffff').setFontWeight('bold');if(values.length)s.getRange(2,1,values.length,headers.length).setValues(values.map(r=>r.map(sheetText_)));s.setFrozenRows(1);s.autoResizeColumns(1,headers.length);}
function actualizarReportes_(){const users=rows_('Users'),courses=rows_('Courses'),attempts=rows_('Attempts');writeReport_('Reporte_Formacion',['Nombre','Documento','Correo','Empresa','Área','Cargo','Ciudad','Curso','Inscripción','Evaluación','Nota','Estado','Intentos'],rows_('Enrollments').map(e=>{const u=users.find(x=>x.id===e.userId)||{},c=courses.find(x=>x.id===e.courseId)||{},aa=attempts.filter(a=>a.userId===e.userId&&a.courseId===e.courseId).sort((a,b)=>a.date.localeCompare(b.date)),a=aa.find(x=>x.passed)||aa[aa.length-1];return [u.name,u.document,u.email,u.company,u.area,u.position,u.city,c.title,e.date,a?a.date:'',a?a.score:'',a?(a.passed?'Aprobado':'No aprobado'):'Pendiente',aa.length];}));writeReport_('Reporte_Certificados',['Código','Nombre','Correo','Curso o ruta','Horas','Fecha','Empresa','Estado','Envío'],rows_('Certificates').map(c=>[c.code,c.name,c.email,c.title,c.hours,c.date,c.company,c.revoked?'Revocado':'Vigente',c.mailStatus]));writeReport_('Reporte_Intentos',['Nombre','Documento','Correo','Empresa','Área','Cargo','Ciudad','Curso','Fecha','Nota','Estado'],attempts.map(a=>{const u=users.find(x=>x.id===a.userId)||{};return [u.name,u.document,u.email,u.company,u.area,u.position,u.city,a.courseTitle,a.date,a.score,a.passed?'Aprobado':'No aprobado'];}));}



function certificateNeedsPdf_(c){return !c.fileId||!!prop_('CERTIFICATE_PREMIUM_TEMPLATE_ID')&&c.designVersion!=='xpanzia-2-transparent';}

// Instalación independiente de Xpanzia. Ejecutar desde el editor del NUEVO proyecto.
function instalarXpanzia(){
 instalar();
 actualizarCampusV3();
 if(!prop_('CERTIFICATE_PREMIUM_TEMPLATE_ID'))prepararCertificadoPremium();
 console.log('Xpanzia Group listo. Continúa con Implementar > Nueva implementación > Aplicación web.');
}
function revisarInstalacionXpanzia(){
 resetRequest_();
 console.log('Base de datos: '+db_().getUrl());
 console.log('Plantilla PDF: '+(prop_('CERTIFICATE_PREMIUM_TEMPLATE_ID')?'CONFIGURADA':'FALTA ejecutar instalarXpanzia'));
 console.log('Portal público: '+(settings_().portalUrl||'FALTA guardar en Administración > Configuración'));
 console.log('Automatización de certificados: '+(ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='procesarPendientes')?'CONFIGURADA':'FALTA ejecutar instalarXpanzia'));
 console.log('Cuota de destinatarios de correo restante hoy: '+MailApp.getRemainingDailyQuota());
}
