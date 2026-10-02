import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
function loadVendor(name){const m={exports:{}};new Function('module','exports',readFileSync(new URL('../vendor/'+name,import.meta.url),'utf8'))(m,m.exports);return m.exports;}
const JSZip=loadVendor('jszip.min.js'),PDFLib=loadVendor('pdf-lib.min.js');
globalThis.window={JSZip,PDFLib};globalThis.JSZip=JSZip;
const {createDocx,createPdf}=await import('../js/documents.js');
test('Word y PDF conservan timestamps y no incrustan capturas automáticas',async()=>{
 const doc={title:'Procedimiento: revisión y validación',sections:[{order:1,title:'Pasos',paragraphs:['Información técnica. '.repeat(1500)],numbered_items:['[ACC-00001] Abrir sistema · Video: 00:00:01–00:00:03 · Captura sugerida: 00:00:02','Paso sin captura','[ACC-00002] Guardar · Video: 00:00:10–00:00:12 · Captura sugerida: no necesaria']}]};
 const word=await createDocx(doc);const z=await JSZip.loadAsync(await word.arrayBuffer());
 const xml=await z.file('word/document.xml').async('text');
 assert.match(xml,/Captura sugerida: 00:00:02/);assert.match(xml,/Video: 00:00:01–00:00:03/);
 assert.equal(Object.keys(z.files).some(x=>/^word\/media\/evidence_/i.test(x)),false);
 const pdf=await createPdf(doc);const parsed=await PDFLib.PDFDocument.load(await pdf.arrayBuffer());assert.ok(parsed.getPageCount()>3);
});
