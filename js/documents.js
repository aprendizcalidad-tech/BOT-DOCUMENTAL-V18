import {xmlEsc, safeName, bytes, downloadBlob} from './utils.js';

function p(text='',style='',opts={}){const st=style?`<w:pStyle w:val="${style}"/>`:'';const jc=opts.center?'<w:jc w:val="center"/>':'';const bold=opts.bold?'<w:b/>':'';const italic=opts.italic?'<w:i/>':'';const sz=opts.size?`<w:sz w:val="${opts.size}"/><w:szCs w:val="${opts.size}"/>`:'';return `<w:p><w:pPr>${st}${jc}</w:pPr><w:r><w:rPr>${bold}${italic}${sz}</w:rPr><w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r></w:p>`}
function tableXml(t){const headers=t.headers||[],rows=t.rows||[];if(!headers.length)return'';const cell=v=>`<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>${p(v)}</w:tc>`;const row=r=>`<w:tr>${r.map(cell).join('')}</w:tr>`;return `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="AAB4C2"/><w:left w:val="single" w:sz="4" w:color="AAB4C2"/><w:bottom w:val="single" w:sz="4" w:color="AAB4C2"/><w:right w:val="single" w:sz="4" w:color="AAB4C2"/><w:insideH w:val="single" w:sz="4" w:color="D0D6DF"/><w:insideV w:val="single" w:sz="4" w:color="D0D6DF"/></w:tblBorders></w:tblPr>${row(headers)}${rows.map(r=>row([...r,...Array(Math.max(0,headers.length-r.length)).fill('')].slice(0,headers.length))).join('')}</w:tbl>`}
function minimalStyles(){return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="34"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`}
function minimalDoc(body,sectPr=''){return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body}${sectPr||'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'}</w:body></w:document>`}

export async function createDocx(finalDoc,{templateFile=null}={}){
  if(!window.JSZip)throw new Error('JSZip no cargó.');
  const zip=new JSZip();let template=false;let originalDoc='';let rels='';let sectPr='';
  if(templateFile&&/\.docx$/i.test(templateFile.name)){
    const z=await JSZip.loadAsync(await templateFile.arrayBuffer());
    for(const [name,item] of Object.entries(z.files)){if(!item.dir)zip.file(name,await item.async('uint8array'))}
    originalDoc=await z.file('word/document.xml')?.async('text')||'';
    rels=await z.file('word/_rels/document.xml.rels')?.async('text')||'';
    const m=originalDoc.match(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/i);sectPr=m?m[0]:'';template=true;
  }else{
    const contentTypes=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
    zip.file('[Content_Types].xml',contentTypes);zip.file('_rels/.rels',`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);zip.file('word/styles.xml',minimalStyles());
    rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  }
  let body='';
  body+=p(finalDoc.title||'Documento generado','',{center:true,bold:true,size:34});if(finalDoc.subtitle)body+=p(finalDoc.subtitle,'',{center:true,italic:true});if(finalDoc.introductory_note)body+=p(finalDoc.introductory_note);
  for(const sec of finalDoc.sections||[]){
    body+=p(`${sec.order}. ${sec.title}`,'',{bold:true,size:28});
    for(const x of sec.paragraphs||[])body+=p(x);
    for(let i=0;i<(sec.numbered_items||[]).length;i++)body+=p(`${sec.order}.${i+1}. ${sec.numbered_items[i]}`);
    for(const x of sec.bullets||[])body+=p(`• ${x}`);
    for(const t of sec.tables||[]){if(t.title)body+=p(t.title,'',{bold:true});body+=tableXml(t)}
    if((sec.source_basis||[]).length)body+=p(`Sustento: ${(sec.source_basis||[]).join(' | ')}`,'',{italic:true,size:18});
  }
  let docXml=minimalDoc(body,sectPr);
  if(template&&originalDoc)docXml=originalDoc.replace(/<w:body\b[^>]*>[\s\S]*?<\/w:body>/i,`<w:body>${body}${sectPr}</w:body>`);
  zip.file('word/document.xml',docXml);zip.file('word/_rels/document.xml.rels',rels);
  return await zip.generateAsync({type:'blob',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',compression:'DEFLATE',compressionOptions:{level:6}});
}

export async function createPdf(finalDoc){
 if(!window.PDFLib)throw new Error('No se pudo cargar el motor PDF incluido.');
 const {PDFDocument,StandardFonts,rgb}=window.PDFLib;
 const pdf=await PDFDocument.create();const normal=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold),italic=await pdf.embedFont(StandardFonts.HelveticaOblique);
 const W=595.28,H=841.89,L=50,R=50,T=52,B=52;let page,y;
 const addPage=()=>{page=pdf.addPage([W,H]);y=H-T;};addPage();
 const room=h=>{if(y-h<B)addPage();};
 const safe=(value,font)=>Array.from(String(value||'')).map(c=>{if(c==='\n')return c;try{font.encodeText(c);return c;}catch{return '?';}}).join('');
 const write=(value,size=10,style='normal',center=false)=>{
  const font=style==='bold'?bold:style==='italic'?italic:normal;
  for(const para of safe(value,font).split('\n')){
   const lines=[];let line='';
   for(const word of para.split(/\s+/)){
    if(font.widthOfTextAtSize((line?line+' ':'')+word,size)>W-L-R){if(line)lines.push(line);line='';for(const char of word){if(font.widthOfTextAtSize(line+char,size)>W-L-R){lines.push(line);line='';}line+=char;}}
    else line+=(line?' ':'')+word;
   }
   if(line||!lines.length)lines.push(line);
   for(const line of lines){room(size*1.4);page.drawText(line,{x:center?(W-font.widthOfTextAtSize(line,size))/2:L,y,size,font,color:rgb(.1,.12,.16)});y-=size*1.4;}y-=4;
  }
 };
 write(finalDoc.title||'Documento generado',18,'bold',true);if(finalDoc.subtitle)write(finalDoc.subtitle,11,'italic',true);if(finalDoc.introductory_note)write(finalDoc.introductory_note);
 for(const sec of finalDoc.sections||[]){room(35);write(`${sec.order}. ${sec.title}`,13,'bold');for(const value of sec.paragraphs||[])write(value);for(let i=0;i<(sec.numbered_items||[]).length;i++)write(`${sec.order}.${i+1}. ${sec.numbered_items[i]}`);for(const value of sec.bullets||[])write('• '+value);for(const table of sec.tables||[]){if(table.title)write(table.title,11,'bold');if(table.headers?.length)write(table.headers.join(' | '),9,'bold');for(const row of table.rows||[])write(row.map((cell,i)=>`${table.headers?.[i]||i+1}: ${cell}`).join(' | '),9);}if(sec.source_basis?.length)write('Sustento: '+sec.source_basis.join(' | '),8,'italic');}
 const pages=pdf.getPages();pages.forEach((p,i)=>p.drawText(`Página ${i+1} de ${pages.length}`,{x:W-R-90,y:22,size:8,font:normal}));
 return new Blob([await pdf.save()],{type:'application/pdf'});
}
export function downloadOutputs({docxBlob,pdfBlob,title}){const base=safeName(title||'documento');if(docxBlob)downloadBlob(docxBlob,`${base}.docx`);if(pdfBlob)setTimeout(()=>downloadBlob(pdfBlob,`${base}.pdf`),250)}
export {bytes};
