import crypto from 'node:crypto';

const MCP_URL = process.env.COROS_MCP_URL || 'https://mcpeu.coros.com/mcp';
const ACCESS_COOKIE = 'coach_coros_access';

function keyMaterial(){
  const secret=process.env.COROS_COOKIE_SECRET||process.env.SESSION_SECRET||process.env.OPENAI_API_KEY;
  if(!secret)throw new Error('COROS_COOKIE_SECRET manquant');
  return crypto.createHash('sha256').update(`coach-coros-cookie:${secret}`).digest();
}
function unseal(value){
  if(!value)return null;
  try{
    const[iv,tag,data]=String(value).split('.');
    const decipher=crypto.createDecipheriv('aes-256-gcm',keyMaterial(),Buffer.from(iv,'base64url'));
    decipher.setAuthTag(Buffer.from(tag,'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8'));
  }catch{return null;}
}
function requestCookie(request,name){
  for(const part of(request.headers.get('cookie')||'').split(';')){
    const[k,...rest]=part.trim().split('=');
    if(k===name)return decodeURIComponent(rest.join('='));
  }
  return null;
}
function responseCookie(setCookies,name){
  const prefix=`${name}=`;
  for(const line of[...(setCookies||[])].reverse()){
    if(!String(line).startsWith(prefix))continue;
    return decodeURIComponent(String(line).slice(prefix.length).split(';')[0]);
  }
  return null;
}
function accessToken(request,result){
  const sealed=responseCookie(result?.setCookies,ACCESS_COOKIE)||requestCookie(request,ACCESS_COOKIE);
  return unseal(sealed)?.accessToken||null;
}
function parseSseOrJson(text,type){
  if(!String(type||'').includes('text/event-stream')){try{return JSON.parse(text)}catch{return{result:{content:[{type:'text',text}]}}}}
  const chunks=[];let current=[];
  for(const line of String(text||'').split(/\r?\n/)){
    if(!line){if(current.length)chunks.push(current.join('\n'));current=[];continue;}
    if(line.startsWith('data:'))current.push(line.slice(5).trimStart());
  }
  if(current.length)chunks.push(current.join('\n'));
  for(let i=chunks.length-1;i>=0;i--){try{return JSON.parse(chunks[i])}catch{}}
  throw new Error('Réponse MCP COROS illisible');
}
async function rpc(token,method,params,id){
  const response=await fetch(MCP_URL,{method:'POST',headers:{authorization:`Bearer ${token}`,accept:'application/json, text/event-stream','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params:params||{}})});
  const text=await response.text();
  if(!response.ok)throw new Error(`MCP COROS ${response.status}: ${text.slice(0,160)}`);
  const payload=parseSseOrJson(text,response.headers.get('content-type'));
  if(payload?.error)throw new Error(payload.error.message||'Erreur MCP COROS');
  return payload;
}
function parseMaybeJson(text){if(typeof text!=='string')return text;try{return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))}catch{return text;}}
function extract(result){
  if(!result)return null;
  if(result.structuredContent!==undefined)return result.structuredContent;
  const values=(result.content||[]).filter(x=>typeof x?.text==='string').map(x=>parseMaybeJson(x.text));
  return values.length===1?values[0]:values.length?values:result;
}
async function tool(token,name,args={}){
  await rpc(token,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'Coach COROS Platform',version:'1.5.0'}},1);
  return extract((await rpc(token,'tools/call',{name,arguments:args},2))?.result);
}
function key(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');}
function entry(root,names){
  const wanted=new Set(names.map(key)),q=[root],seen=new Set();
  while(q.length){const x=q.shift();if(!x||typeof x!=='object'||seen.has(x))continue;seen.add(x);if(Array.isArray(x)){q.push(...x);continue;}for(const[k,v]of Object.entries(x)){if(wanted.has(key(k))&&['string','number','boolean'].includes(typeof v)&&v!=='')return v;if(v&&typeof v==='object')q.push(v);}}
  return null;
}
function flatten(root){
  if(root==null)return'';if(typeof root==='string')return root;
  const out=[],q=[root],seen=new Set();
  while(q.length){const x=q.shift();if(x==null)continue;if(typeof x==='string'){out.push(x);continue;}if(typeof x!=='object'||seen.has(x))continue;seen.add(x);if(Array.isArray(x)){q.push(...x);continue;}for(const[k,v]of Object.entries(x)){if(['string','number','boolean'].includes(typeof v))out.push(`${k}: ${v}`);else if(v&&typeof v==='object')q.push(v);}}
  return out.join('\n');
}
function dateInTimezone(date,timezone){if(!(date instanceof Date)||Number.isNaN(date.getTime()))return null;return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(date);}
function dateOf(v,timezone){
  if(!v&&v!==0)return null;const s=String(v).trim();
  let m=s.match(/\b(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/);if(m)return`${m[1]}-${m[2]}-${m[3]}`;
  const n=Number(s);if(Number.isFinite(n)&&n>1e9&&n<1e14)return dateInTimezone(new Date(n>1e11?n:n*1000),timezone);
  const parsed=Date.parse(s);return Number.isFinite(parsed)?dateInTimezone(new Date(parsed),timezone):null;
}
function structuredRefs(raw,timezone){
  const refs=[],q=[raw],seen=new Set();
  while(q.length){const x=q.shift();if(!x||typeof x!=='object'||seen.has(x))continue;seen.add(x);if(Array.isArray(x)){q.push(...x);continue;}const label=entry(x,['labelId','labelID']),sport=entry(x,['sportType','sportTypeCode']);if(label!=null&&sport!=null){const d=entry(x,['startTimestamp','activityStartTimestamp','startDateTime','activityStartTime','startTime','activityDate','startDate','date']);refs.push({id:`coros-${label}`,labelId:String(label),sportType:Number(sport),date:dateOf(d,timezone)});continue;}q.push(...Object.values(x).filter(v=>v&&typeof v==='object'));}
  return refs;
}
function textRefs(raw,timezone){
  const text=flatten(raw),matches=[...text.matchAll(/(?:Label\s*Id|labelId)\s*[:=]\s*([A-Za-z0-9_-]+)/gi)];
  return matches.map((m,i)=>{const a=Math.max(0,(matches[i-1]?.index??m.index-1200)),b=Math.min(text.length,matches[i+1]?.index??m.index+1200),block=text.slice(a,b),sport=block.match(/(?:Sport\s*Type(?:\s*Code)?|sportType)\s*[:=]\s*(\d+)/i)?.[1],ts=block.match(/(?:startTimestamp|activityStartTimestamp|Start\s*Timestamp)\s*[:=]\s*(\d{10,13})/i)?.[1],explicit=block.match(/(?:startDateTime|activityStartTime|activityDate|startDate|Date)\s*[:=]\s*([^\n|]+)/i)?.[1];return sport?{id:`coros-${m[1]}`,labelId:m[1],sportType:Number(sport),date:dateOf(ts||explicit,timezone)}:null;}).filter(Boolean);
}
function uniqueRefs(raw,timezone){
  const refs=structuredRefs(raw,timezone);if(!refs.length)refs.push(...textRefs(raw,timezone));
  const byId=new Map();for(const ref of refs){if(!ref.labelId||!Number.isFinite(ref.sportType))continue;const previous=byId.get(ref.labelId);if(!previous||(!previous.date&&ref.date))byId.set(ref.labelId,ref);}
  return[...byId.values()].filter(x=>x.date).sort((a,b)=>b.date.localeCompare(a.date));
}
function localDateIso(timezone){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function addDays(iso,days){const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
const ymd=iso=>iso.replaceAll('-','');

export async function loadRecentCorosActivityRefs(request,result,{days=14,limit=30}={}){
  const token=accessToken(request,result);if(!token)return[];
  const timezone=process.env.APP_TIMEZONE||'Europe/Paris',today=localDateIso(timezone),start=addDays(today,-Math.max(1,days));
  const raw=await tool(token,'querySportRecords',{startDate:ymd(start),endDate:ymd(today),limit,timezone});
  return uniqueRefs(raw,timezone);
}
