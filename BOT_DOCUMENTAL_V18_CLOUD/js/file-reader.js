import {ext, sha256Blob, isVideoName} from './utils.js';

export async function extractTextFromFile(file){
  const e=ext(file.name);
  if(e==='txt') return {text:await file.text(),pages:null};
  if(e==='docx'){
    if(!window.JSZip)throw new Error('No se pudo cargar el lector Word.');
    const z=await window.JSZip.loadAsync(await file.arrayBuffer());
    const main=z.file('word/document.xml');if(!main)throw new Error('Word no válido');
    const xml=new DOMParser().parseFromString(await main.async('string'),'application/xml');
    if(xml.querySelector('parsererror'))throw new Error('XML de Word no válido');
    const paragraphs=[...xml.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','p')];
    const text=paragraphs.map(p=>[...p.getElementsByTagNameNS('http://schemas.openxmlformats.org/wordprocessingml/2006/main','t')].map(t=>t.textContent).join('')).join('\n');
    return {text,pages:null};
  }
  if(e==='pdf'){
    const pdfjsLib=await import('../vendor/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc=new URL('../vendor/pdf.worker.mjs',import.meta.url).href;
    const pdf=await pdfjsLib.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
    const chunks=[];
    for(let i=1;i<=pdf.numPages;i++){
      const p=await pdf.getPage(i); const tc=await p.getTextContent();
      chunks.push(`[PÁGINA ${i}]\n`+tc.items.map(x=>x.str).join(' '));
    }
    return {text:chunks.join('\n\n'),pages:pdf.numPages};
  }
  throw new Error(`Formato no soportado: .${e}`);
}

export async function buildRecord(file,label='archivo'){
  if(file.size>50*1024*1024)throw new Error('El documento supera 50 MB. Divide la guía.');const fp=await sha256Blob(file);
  if(isVideoName(file.name)||file.type.startsWith('video/')) return {name:file.name,size:file.size,mime:file.type||'video/mp4',extension:ext(file.name),fingerprint:fp,kind:'video',file};
  const {text,pages}=await extractTextFromFile(file);if(text.replace(/\[PÁGINA \d+\]/g,'').trim().length<30)throw new Error('El archivo no tiene texto legible. Si es escaneado, aplica OCR antes de cargarlo.');if(text.length>500000)throw new Error('Documento demasiado extenso. Divide el archivo; no se recortará silenciosamente.');
  return {name:file.name,size:file.size,mime:file.type||'',extension:ext(file.name),fingerprint:fp,kind:label,text,pages,file};
}

export function extractGuideStructure(text=''){
  const lines=String(text).split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const headings=[]; let order=0;
  const headingRx=/^(?:(\d+(?:\.\d+)*)[.)\-:]?\s+)?([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9 /()\-_,.]{2,90})$/;
  for(const line of lines){
    if(/^\[PÁGINA\s+\d+\]$/i.test(line))continue;
    const m=line.match(headingRx); if(!m)continue;
    const title=(m[2]||'').trim();
    if(title.length<3||title.length>100)continue;
    if(/^(PÁGINA|TABLA DE CONTENIDO|ÍNDICE)$/i.test(title))continue;
    if(headings.some(h=>h.title===title))continue;
    headings.push({order:++order,number:m[1]||'',title});
  }
  return headings.slice(0,80);
}
