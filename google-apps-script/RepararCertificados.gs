/* Ejecutar desde el editor, con la cuenta propietaria de la automatización. */
function repararAutomatizacionCertificados(){
 resetRequest_();
 need_(prop_('SPREADSHEET_ID'),'Falta SPREADSHEET_ID. No ejecutes el instalador para resolverlo.');
 need_(prop_('CERTIFICATE_FOLDER_ID'),'Falta CERTIFICATE_FOLDER_ID.');
 need_(prop_('CERTIFICATE_PREMIUM_TEMPLATE_ID'),'Ejecuta prepararCertificadoPremium y vuelve a ejecutar esta reparación.');
 db_();
 DriveApp.getFolderById(prop_('CERTIFICATE_FOLDER_ID')).getName();
 const template=SlidesApp.openById(prop_('CERTIFICATE_PREMIUM_TEMPLATE_ID'));
 const titles=template.getSlides()[0].getShapes().map(s=>s.getTitle());
 need_(titles.includes('uc_name'),'La plantilla no es compatible. Ejecuta prepararCertificadoPremium.');
 const quota=MailApp.getRemainingDailyQuota();
 const lock=LockService.getScriptLock();
 need_(lock.tryLock(5000),'Hay un guardado en curso. Vuelve a ejecutar la reparación.');
 try{
  const triggers=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='procesarPendientes');
  // Crear primero: si Google rechaza la creación conservamos el activador anterior.
  ScriptApp.newTrigger('procesarPendientes').timeBased().everyMinutes(1).create();
  triggers.forEach(t=>ScriptApp.deleteTrigger(t));
  resetRequest_();
  let count=0;
  rows_('Certificates').forEach(c=>{
   if(!c.revoked&&(certificateNeedsPdf_(c)||c.mailStatus!=='sent')){
    put_('Certificates',{...c,nextTry:0,tries:0});count++;
   }
  });
  console.log('Activador configurado cada minuto. Pendientes habilitados: '+count+'. Cuota de correo restante: '+quota+'.');
  console.log('Ahora ejecuta procesarPendientes y luego diagnosticarCertificados. Si ya hay un proceso activo, espera a que termine.');
 }finally{lock.releaseLock();}
}

function diagnosticarCertificados(){
 resetRequest_();
 const certs=rows_('Certificates').filter(c=>!c.revoked);
 const triggers=ScriptApp.getProjectTriggers().filter(t=>t.getHandlerFunction()==='procesarPendientes');
 const lease=JSON.parse(prop_('WORKER_LEASE_V3')||'null');
 console.log('Activadores visibles en esta cuenta: '+triggers.length);
 console.log('Proceso activo o pendiente de liberar: '+!!(lease&&lease.until>Date.now()));
 console.log('Cuota de destinatarios de correo restante: '+MailApp.getRemainingDailyQuota());
 console.log('PDF pendientes: '+certs.filter(c=>certificateNeedsPdf_(c)).length+'; correos pendientes: '+certs.filter(c=>c.mailStatus!=='sent').length);
 certs.filter(c=>c.error).slice(0,10).forEach(c=>console.log('Certificado '+c.code+' | '+c.error+' | próximo intento: '+(c.nextTry?new Date(c.nextTry).toISOString():'sin espera')));
 console.log('Revisa también Ejecuciones: los errores anteriores a procesar un certificado aparecen allí.');
}
