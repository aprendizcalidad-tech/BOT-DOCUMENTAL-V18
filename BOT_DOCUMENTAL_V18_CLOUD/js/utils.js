export const $ = (s, root=document) => root.querySelector(s);
export const $$ = (s, root=document) => [...root.querySelectorAll(s)];
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
export const esc = (v='') => String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
export const xmlEsc = (v='') => String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&apos;"}[c]));
export function bytes(n=0){const u=['B','KB','MB','GB'];let i=0,x=Number(n)||0;while(x>=1024&&i<u.length-1){x/=1024;i++}return `${x.toFixed(i?1:0)} ${u[i]}`}
export function ext(name=''){const m=String(name).toLowerCase().match(/\.([a-z0-9]+)$/);return m?m[1]:''}
export function isVideoName(name=''){return ['mp4','mpeg','mov','avi','flv','mpg','webm','wmv','3gp','3gpp'].includes(ext(name))}
export function isDocName(name=''){return ['pdf','docx','txt'].includes(ext(name))}
export function safeName(v='documento'){return String(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'_').replace(/^_+|_+$/g,'').slice(0,120)||'documento'}
export async function sha256Blob(blob){const b=await blob.arrayBuffer();const h=await crypto.subtle.digest('SHA-256',b);return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('')}
export function downloadBlob(blob,name){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500)}
export function jsonBlob(obj){return new Blob([JSON.stringify(obj,null,2)],{type:'application/json'})}
export function dataUrlToBytes(dataUrl){const [,b64]=dataUrl.split(',');const raw=atob(b64);const arr=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)arr[i]=raw.charCodeAt(i);return arr}
export function blobToDataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})}
export function parseClock(v=''){const s=String(v).trim();if(!s)return 0;if(/^\d+(\.\d+)?$/.test(s))return Number(s);const p=s.split(':').map(Number);if(p.some(Number.isNaN))return 0;if(p.length===3)return p[0]*3600+p[1]*60+p[2];if(p.length===2)return p[0]*60+p[1];return p[0]||0}
export function clock(sec=0){sec=Math.max(0,Math.round(Number(sec)||0));const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=sec%60;return [h,m,s].map(x=>String(x).padStart(2,'0')).join(':')}
export function unique(arr){return [...new Set((arr||[]).filter(Boolean))]}
export function debounce(fn,wait=350){let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),wait)}}
export function extractDriveId(v=''){const s=String(v).trim();if(/^[\w-]{20,}$/.test(s))return s;const patterns=[/\/d\/([\w-]+)/,/id=([\w-]+)/,/\/file\/d\/([\w-]+)/];for(const p of patterns){const m=s.match(p);if(m)return m[1]}return ''}
export function cleanJsonText(text=''){let s=String(text).trim();s=s.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');const a=s.indexOf('{'),b=s.lastIndexOf('}');if(a>=0&&b>a)s=s.slice(a,b+1);return s}
export function normalizeArray(v){return Array.isArray(v)?v:[]}
export function ensureText(v){return v==null?'':String(v)}
export function uid(prefix='id'){return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`}
