import crypto from 'node:crypto';

const MCP_URL = process.env.COROS_MCP_URL || 'https://mcpeu.coros.com/mcp';
const ACCESS_COOKIE = 'coach_coros_access';
const CACHE_COOKIE = 'coach_coros_cache';

const SPORT_NAMES = new Map([
  [100,'Course extérieure'],[101,'Course sur tapis'],[102,'Trail'],[103,'Course sur piste'],[104,'Randonnée'],
  [200,'Vélo de route'],[201,'Vélo indoor'],[202,'Vélo électrique'],[203,'Gravel'],[204,'VTT'],[205,'VTTAE'],
  [300,'Natation piscine'],[301,'Natation eau libre'],[400,'Cardio'],[401,'Cardio GPS'],[402,'Renforcement'],
  [900,'Marche'],[901,'Corde à sauter'],[902,'Escaliers'],[903,'Elliptique'],[904,'Yoga'],[905,'Pilates'],[906,'Boxe']
]);

function keyMaterial(){
  const secret=process.env.COROS_COOKIE_SECRET||process.env.SESSION_SECRET||process.env.OPENAI_API_KEY;
  if(!secret) throw new Error('COROS_COOKIE_SECRET manquant');
  return crypto.createHash('sha256').update(`coach-coros-cookie:${secret}`).digest();
}
function b64(v){return Buffer.from(v).toString('base64url')}
function seal(value){
  const iv=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',keyMaterial(),iv);
  const encrypted=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(value),'utf8')),cipher.final()]);
  return `${b64(iv)}.${b64(cipher.getAuthTag())}.${b64(encrypted)}`;
}
function unseal(value){
  if(!value) return null;
  try{
    const [iv,tag,data]=String(value).split('.');
    const decipher=crypto.createDecipheriv('aes-256-gcm',keyMaterial(),Buffer.from(iv,'base64url'));
    decipher.setAuthTag(Buffer.from(tag,'base64url'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,'base64url')),decipher.final()]).toString('utf8'));
  }catch{return null}
}
function cookie(name,value,maxAge){return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; Secure; SameSite=Lax; HttpOnly`}
function requestCookie(request,name){
  for(const part of (request.headers.get('cookie')||'').split(';')){
    const [k,...rest]=part.trim().split('=');
    if(k===name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
function responseCookie(setCookies,name){
  const prefix=`${name}=`;
  for(const line of [...(setCookies||[])].reverse()){
    if(!String(line).startsWith(prefix)) continue;
    return decodeURIComponent(String(line).slice(prefix.length).split(';')[0]);
  }
  return null;
}
function accessToken(request,result){
  const sealed=responseCookie(result?.setCookies,ACCESS_COOKIE)||requestCookie(request,ACCESS_COOKIE);
  return unseal(sealed)?.accessToken||null;
}

function parseSseOrJson(text,type){
  if(!String(type||'').includes('text/event-stream')){try{return JSON.parse(text)}catch{return {result:{content:[{type:'text',text}]}}}}
  const chunks=[]; let current=[];
  for(const line of text.split(/\r?\n/)){
    if(!line){if(current.length)chunks.push(current.join('\n'));current=[];continue}
    if(line.startsWith('data:')) current.push(line.slice(5).trimStart());
  }
  if(current.length) chunks.push(current.join('\n'));
  for(let i=chunks.length-1;i>=0;i--){try{return JSON.parse(chunks[i])}catch{}}
  throw new Error('Réponse MCP COROS illisible');
}
async function rpc(token,method,params,id){
  const response=await fetch(MCP_URL,{method:'POST',headers:{authorization:`Bearer ${token}`,accept:'application/json, text/event-stream','content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id,method,params:params||{}})});
  const text=await response.text();
  if(!response.ok) throw new Error(`MCP COROS ${response.status}: ${text.slice(0,180)}`);
  const payload=parseSseOrJson(text,response.headers.get('content-type'));
  if(payload?.error) throw new Error(payload.error.message||'Erreur MCP COROS');
  return payload;
}
function parseMaybeJson(text){if(typeof text!=='string')return text;try{return JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''))}catch{return text}}
function extract(result){
  if(!result)return null;
  if(result.structuredContent!==undefined)return result.structuredContent;
  const values=(result.content||[]).filter(x=>typeof x?.text==='string').map(x=>parseMaybeJson(x.text));
  return values.length===1?values[0]:values.length?values:result;
}
async function tool(token,name,args={}){
  await rpc(token,'initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'Coach COROS Platform',version:'1.3.0'}},1);
  return extract((await rpc(token,'tools/call',{name,arguments:args},2))?.result);
}

function key(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'')}
function flatten(root){
  if(root==null)return '';
  if(typeof root==='string')return root;
  const out=[],q=[root],seen=new Set();
  while(q.length){const x=q.shift();if(x==null)continue;if(typeof x==='string'){out.push(x);continue}if(typeof x!=='object'||seen.has(x))continue;seen.add(x);if(Array.isArray(x)){q.push(...x);continue}for(const [k,v] of Object.entries(x)){if(['string','number','boolean'].includes(typeof v))out.push(`${k}: ${v}`);else if(v&&typeof v==='object')q.push(v)}}
  return out.join('\n');
}
function entry(root,names){
  const wanted=new Set(names.map(key)),q=[root],seen=new Set();
  while(q.length){const x=q.shift();if(!x||typeof x!=='object'||seen.has(x))continue;seen.add(x);if(Array.isArray(x)){q.push(...x);continue}for(const [k,v] of Object.entries(x)){if(wanted.has(key(k))&&['string','number','boolean'].includes(typeof v)&&v!=='')return {key:k,value:v};if(v&&typeof v==='object')q.push(v)}}
  return null;
}
function num(v){if(typeof v==='number'&&Number.isFinite(v))return v;const m=String(v??'').replace(',','.').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):null}
function findNum(root,names,regexes=[]){const e=entry(root,names),d=num(e?.value);if(d!==null)return d;const t=flatten(root);for(const r of regexes){const v=num(t.match(r)?.[1]);if(v!==null)return v}return null}
function findText(root,names,regexes=[]){const e=entry(root,names);if(e?.value!==undefined&&e.value!=='')return String(e.value).trim();const t=flatten(root);for(const r of regexes){const m=t.match(r);if(m?.[1])return m[1].trim()}return null}

function sleepDuration(...sources){
  const names=['mainSleepDuration','mainSleepDurationSeconds','mainSleepDurationMinutes','sleepDuration','sleepDurationSeconds','sleepDurationMinutes','totalSleepDuration','totalSleepTime','sleepTotalTime','sleepMinutes','sleepSeconds','mainSleepTime','totalSleep','mainSleep'];
  for(const src of sources){
    const e=entry(src,names); if(e){
      const text=String(e.value).trim(), hm=text.match(/(\d+)\s*h\s*(\d+)?\s*(?:m|min)?/i), clock=text.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
      if(hm)return `${Number(hm[1])} h ${String(Number(hm[2]||0)).padStart(2,'0')}`;
      if(clock)return `${Number(clock[1])} h ${clock[2]}`;
      const n=num(e.value); if(n!==null){const k=key(e.key);let mins=k.includes('second')?Math.round(n/60):k.includes('minute')?Math.round(n):n>1440?Math.round(n/60):n<=24?Math.round(n*60):Math.round(n);if(mins>0&&mins<=1440)return `${Math.floor(mins/60)} h ${String(mins%60).padStart(2,'0')}`}
    }
    const t=flatten(src);
    let m=t.match(/(?:main\s+sleep|total\s+sleep|sleep)(?:\s+(?:duration|time))?\s*[:=]\s*(\d+\s*h\s*\d*\s*(?:m|min)?)/i);if(m){const p=m[1].match(/(\d+)\s*h\s*(\d+)?/i);return `${Number(p[1])} h ${String(Number(p[2]||0)).padStart(2,'0')}`}
    m=t.match(/(?:main\s+sleep|total\s+sleep|sleep)(?:\s+(?:duration|time))?\s*[:=]\s*(\d{1,2}):(\d{2})/i);if(m)return `${Number(m[1])} h ${m[2]}`;
  }
  return null;
}

function dateOf(v){if(!v&&v!==0)return null;const s=String(v),m=s.match(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/);if(m)return `${m[1]}-${m[2]}-${m[3]}`;const n=num(v);if(n&&n>1e9){const ms=n>1e10?n:n*1000;try{return new Date(ms).toISOString().slice(0,10)}catch{}}return null}
function structuredRefs(raw){
  const refs=[],q=[raw],seen=new Set();
  while(q.length){const x=q.shift();if(!x||typeof x!=='object'||seen.has(x))continue;seen.add(x);if(Array.isArray(x)){q.push(...x);continue}const l=entry(x,['labelId','labelID']),s=entry(x,['sportType','sportTypeCode']);if(l?.value!=null&&s?.value!=null){const d=entry(x,['date','startDate','activityDate','startTime','startTimestamp']);refs.push({labelId:String(l.value),sportType:Number(s.value),date:dateOf(d?.value),source:x});continue}q.push(...Object.values(x).filter(v=>v&&typeof v==='object'))}
  return refs;
}
function textRefs(raw){
  const t=flatten(raw),matches=[...t.matchAll(/(?:Label\s*Id|labelId)\s*[:=]\s*([A-Za-z0-9_-]+)/gi)];
  return matches.map((m,i)=>{const a=Math.max(0,(matches[i-1]?.index??m.index-1600)),b=Math.min(t.length,matches[i+1]?.index??m.index+1600),block=t.slice(a,b);const sm=block.match(/(?:Sport\s*Type(?:\s*Code)?|sportType)\s*[:=]\s*(\d+)/i),dates=[...block.matchAll(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/g)].map(x=>`${x[1]}-${x[2]}-${x[3]}`),ts=[...block.matchAll(/(?:startTimestamp|Start\s*Timestamp)\s*[:=]\s*(\d{10,13})/gi)];return {labelId:m[1],sportType:sm?Number(sm[1]):null,date:dates.at(-1)||(ts.length?dateOf(ts.at(-1)[1]):null),source:block}}).filter(x=>x.sportType!=null);
}
function latestRef(raw){const refs=structuredRefs(raw);if(!refs.length)refs.push(...textRefs(raw));refs.sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));return refs[0]||null}
function analysisText(raw){if(!raw)return null;if(typeof raw==='string')return raw.trim().slice(0,1800);const direct=findText(raw,['analysis','summary','coachSummary','recommendation','text','message']);return (direct||flatten(raw).trim()||null)?.slice(0,1800)||null}
function enrichActivity(base,ref,detail,analysis){
  if(!base&&!ref&&!detail)return null;const src=detail||ref?.source||{};const sportType=ref?.sportType??base?.sportType??null;
  let sport=findText(src,['sportName','sportTypeName','activityName','name'],[/(?:Sport\s*Name|Activity\s*Name|Workout\s*Name)\s*[:=]\s*([^\n|]+)/i])||base?.sport;
  if(!sport||/^Activité COROS$/i.test(sport))sport=SPORT_NAMES.get(Number(sportType))||'Activité COROS';
  const avg=findNum(src,['avgHr','averageHeartRate','avgHeartRate','averageHeartRateBpm','heartRateAvg','avgPulse'],[/(?:Average|Avg)\s*(?:Heart\s*Rate|HR|Pulse)\s*[:=]\s*(\d+)/i]);
  const max=findNum(src,['maxHr','maxHeartRate','maximumHeartRate','maxHeartRateBpm','heartRateMax','maxPulse'],[/Max(?:imum)?\s*(?:Heart\s*Rate|HR|Pulse)\s*[:=]\s*(\d+)/i]);
  return {...(base||{}),id:ref?.labelId?`coros-${ref.labelId}`:(base?.id||`coros-${Date.now()}`),labelId:ref?.labelId||base?.labelId||null,sportType,date:ref?.date||base?.date||dateOf(entry(src,['date','startDate','startTime','startTimestamp'])?.value),sport,avgHr:avg??base?.avgHr??null,maxHr:max??base?.maxHr??null,coachNote:analysisText(analysis)||base?.coachNote||'Activité synchronisée depuis COROS.',source:'COROS MCP'};
}

function todayIso(){return new Intl.DateTimeFormat('en-CA',{timeZone:process.env.APP_TIMEZONE||'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())}
function addDays(iso,days){const d=new Date(`${iso}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function ymd(iso){return iso.replaceAll('-','')}
function safeError(e){return String(e?.message||e||'Erreur').replace(/Bearer\s+\S+/gi,'Bearer [redacted]').slice(0,200)}

export async function enhanceCorosSync(request,result){
  const token=accessToken(request,result);if(!token)return result;
  const cache=structuredClone(result.cache);cache.version=3;cache.errors||={};cache.diagnostics||={};
  const timezone=process.env.APP_TIMEZONE||'Europe/Paris',today=todayIso();
  let sleep=null,daily=null,records=null,detail=null,analysis=null;
  try{sleep=await tool(token,'querySleepData',{days:2,timezone})}catch(e){cache.errors.sleepExtra=safeError(e)}
  try{daily=await tool(token,'queryDailyHealthData',{days:2,timezone})}catch(e){cache.errors.dailyHealth=safeError(e)}
  const sd=sleepDuration(sleep,daily);if(sd)cache.metrics.sleepDuration=sd;
  if(cache.metrics.sleepScore==null)cache.metrics.sleepScore=findNum(sleep,['sleepScore','sleepQualityScore'],[/Sleep\s*Score\s*[:=]\s*(\d+)/i])??findNum(daily,['sleepScore','sleepQualityScore'],[/Sleep\s*(?:Score|Quality)\s*[:=]\s*(\d+)/i]);
  try{records=await tool(token,'querySportRecords',{startDate:ymd(addDays(today,-14)),endDate:ymd(today),limit:20,timezone})}catch(e){cache.errors.activityListExtra=safeError(e)}
  const ref=latestRef(records);
  if(ref?.labelId&&Number.isFinite(ref.sportType)){
    try{detail=await tool(token,'getActivityDetail',{labelId:ref.labelId,sportType:ref.sportType})}catch(e){cache.errors.activityDetailExtra=safeError(e)}
    try{analysis=await tool(token,'analyzeActivityDetail',{labelId:ref.labelId,sportType:ref.sportType,focus:'fréquence cardiaque, allure, stabilité de l’effort, charge et conséquence pour la prochaine séance'})}catch(e){cache.errors.activityAnalysis=safeError(e)}
  }
  cache.latestActivity=enrichActivity(cache.latestActivity,ref,detail,analysis);cache.date=today;cache.syncedAt=new Date().toISOString();
  cache.diagnostics.extra={sleepFound:Boolean(cache.metrics?.sleepDuration),activityDateFound:Boolean(cache.latestActivity?.date),activityMaxHrFound:cache.latestActivity?.maxHr!=null,activityAnalysisFound:Boolean(cache.latestActivity?.coachNote&&cache.latestActivity.coachNote!=='Activité synchronisée depuis COROS.'),thresholdHrAvailableFromMcp:false};
  console.log('[COROS extras]',JSON.stringify({detected:cache.diagnostics.extra,errorKeys:Object.keys(cache.errors)}));
  return {cache,setCookies:[...(result.setCookies||[]),cookie(CACHE_COOKIE,seal(cache),60*60*24*7)]};
}
