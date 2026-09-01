if(!window.__coachSafeJsonPatched){window.__coachSafeJsonPatched=true;const nativeJson=Response.prototype.json;Response.prototype.json=async function(){try{return await nativeJson.call(this.clone());}catch(parseError){const raw=await this.text().catch(()=>''),text=String(raw||'').trim();const timeout=/timed out|timeout|an error occurred|function_invocation_failed/i.test(text);return{error:timeout?'Le Coach a mis trop de temps à construire le plan. Réessaie dans quelques instants.':(text||`Réponse serveur invalide (${this.status})`),_nonJson:true,status:this.status};}};}
let freshnessLoadedDay='';
function runtimeLocalDateIso(){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function runtimeFormatToday(v){return new Intl.DateTimeFormat('fr-FR',{weekday:'long',day:'numeric',month:'long'}).format(new Date(`${v}T12:00:00`));}
function setText(s,v){const e=document.querySelector(s);if(e)e.textContent=v;}
function setNoTodaySession(data=null){const hasPlan=Boolean(data?.activePlan),plannedRest=Boolean(hasPlan&&data.activePlan.endDate&&data?.meta?.today<=data.activePlan.endDate),values=!hasPlan?{'#todayTitle':'Aucune séance planifiée','#todaySport':'Aucun plan actif','#todaySportIcon':'🗓️','#todayDuration':'—','#todayZoneBpm':'—','#todayZoneName':'—','#todayRpe':'—','#todayDetails':'Crée ou active un objectif pour que le Coach construise ton plan.'}:plannedRest?{'#todayTitle':'Repos / récupération','#todaySport':'Aucune séance prévue aujourd’hui','#todaySportIcon':'🧘','#todayDuration':'—','#todayZoneBpm':'—','#todayZoneName':'Repos','#todayRpe':'1/10','#todayDetails':'Cette journée sans séance fait partie du plan. Récupère, marche ou fais un peu de mobilité si tu en as envie.'}:{'#todayTitle':'Aucune séance planifiée','#todaySport':'Le plan ne couvre pas cette date','#todaySportIcon':'🗓️','#todayDuration':'—','#todayZoneBpm':'—','#todayZoneName':'—','#todayRpe':'—','#todayDetails':'Aucune séance n’est datée pour aujourd’hui.'};for(const[k,v]of Object.entries(values))setText(k,v);for(const s of['#viewSessionButton','#adaptBtn','#doneBtn']){const b=document.querySelector(s);if(b)b.disabled=true;}}
function maskDemoMetrics(){const values={'#recovery':'—','#sleepDuration':'—','#shortLoad':'—','#recoveryLabel':'COROS non synchronisé','#readinessInsight':'Les métriques COROS du prototype ne sont pas des données du jour.','#formStateLabel':'COROS non synchronisé','#formStateInsight':'La forme et la charge du jour nécessitent une synchronisation COROS réelle.','#progressVo2':'—','#progressThresholdHr':'—','#progressThresholdPace':'—','#progressLoad':'—','#coachRecovery':'Non synchronisé','#profileThresholdHr':'Non synchronisé','#zoneModel':'Zones COROS non synchronisées','#latestSport':'Activité non synchronisée','#latestDate':'Connecte COROS pour importer tes activités','#latestFocus':'—','#coachNote':'Synchronise COROS pour analyser une activité réelle.'};for(const[k,v]of Object.entries(values))setText(k,v);const kpis=document.querySelector('#activityKpis');if(kpis)kpis.innerHTML=['Distance','Durée','Allure','FC moy.'].map(x=>`<div class="activity-kpi"><strong>—</strong><span>${x}</span></div>`).join('');const ab=document.querySelector('#viewActivityButton');if(ab)ab.disabled=true;}
async function applyFreshnessGuard({reload=false}={}){try{if(reload&&typeof load==='function')await load();const response=await fetch('/api/dashboard',{cache:'no-store'});if(!response.ok)throw new Error(`Dashboard ${response.status}`);const data=await response.json();freshnessLoadedDay=data.meta?.today||runtimeLocalDateIso();setText('#todayDate',runtimeFormatToday(freshnessLoadedDay));if(!data.meta?.corosMode||data.meta.corosMode==='demo')maskDemoMetrics();const sessions=data.activePlan?.sessions||[],todaySession=sessions.find(s=>s.date===freshnessLoadedDay)||null;if(!todaySession)setNoTodaySession(data);document.querySelectorAll('[data-session-id]').forEach(b=>b.classList.remove('today'));if(todaySession)document.querySelector(`[data-session-id="${CSS.escape(todaySession.id)}"]`)?.classList.add('today');const future=sessions.filter(s=>s.date&&s.date>=freshnessLoadedDay&&s.status!=='completed').sort((a,b)=>a.date.localeCompare(b.date)),next=future.find(s=>/blocs|seuil|longue|allure|tempo|fartlek|côte|cote/i.test(s.title))||future[0];setText('#nextKeySession',next?`${next.day||''} · ${next.title}`:data.activePlan?'Aucune séance future':'Aucun plan actif');}catch(error){console.error('Freshness guard',error);}}
window.addEventListener('pageshow',()=>applyFreshnessGuard({reload:true}));window.addEventListener('focus',()=>applyFreshnessGuard({reload:true}));document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')applyFreshnessGuard({reload:true});});setInterval(()=>{if(runtimeLocalDateIso()!==freshnessLoadedDay)applyFreshnessGuard({reload:true});},60000);setTimeout(()=>applyFreshnessGuard(),300);
function loadRuntime(src,dataKey){if(document.querySelector(`script[data-${dataKey}]`))return;const s=document.createElement('script');s.src=src;s.async=false;s.setAttribute(`data-${dataKey}`,'true');document.head.appendChild(s);}
loadRuntime('/coros-runtime.js','coros-runtime');loadRuntime('/coach-polish.js','coach-polish');loadRuntime('/plan-continuity.js','plan-continuity');loadRuntime('/plan-v2-runtime.js','plan-v2-runtime');loadRuntime('/plan-v3-runtime.js','plan-v3-runtime');loadRuntime('/plan-v4-fixes.js','plan-v4-fixes');

function activityV6Esc(value=''){return String(value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function ensureActivityV6Styles(){
  if(document.querySelector('#activityV6Styles'))return;
  const style=document.createElement('style');style.id='activityV6Styles';style.textContent=`
    #activityCoachAnalysis.activity-v6{display:grid;gap:10px;color:#24456f;font-size:14px;line-height:1.48}
    #activityCoachAnalysis.activity-v6 .activity-v6-section{padding:11px 12px;border-radius:13px;background:rgba(255,255,255,.7);border:1px solid rgba(77,125,201,.10)}
    #activityCoachAnalysis.activity-v6 .activity-v6-head{display:flex;align-items:center;gap:7px;margin-bottom:5px;font-size:11px;font-weight:800;letter-spacing:.055em;text-transform:uppercase;color:#2f69d8}
    #activityCoachAnalysis.activity-v6 .activity-v6-section p{margin:0;color:#365477}
    #activityCoachAnalysis.activity-v6 .activity-v6-section ul{margin:0;padding-left:17px;display:grid;gap:4px;color:#365477}
    #activityCoachAnalysis.activity-v6 .activity-v6-loading{display:flex;align-items:center;gap:9px;padding:12px;color:#526b8f}
    #activityCoachAnalysis.activity-v6 .activity-v6-dot{width:8px;height:8px;border-radius:50%;background:#326ef1;animation:activityPulse 1s infinite alternate}
    #coachNote{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;overflow:hidden;line-height:1.45}
    @keyframes activityPulse{from{opacity:.3;transform:scale(.8)}to{opacity:1;transform:scale(1)}}
  `;document.head.appendChild(style);
}
function activityV6Sentences(text){return String(text||'').replace(/\s+/g,' ').trim().split(/(?<=[.!?])\s+(?=[A-ZÀ-ÖØ-Ý])/).map(x=>x.trim()).filter(Boolean);}
function activityV6Sections(text){
  let raw=String(text||'').replace(/\r/g,'').replace(/\*\*(.*?)\*\*/g,'$1').replace(/^#{1,4}\s*/gm,'').trim();
  if(!raw)return [];
  const headings=[['Bilan de la séance','📊'],['Ce que ça montre','↗'],['Impact sur le plan','🗓️'],['À surveiller','◉']];
  const aliases=[
    [/\b(?:Bilan(?: de la séance)?|Résumé)\s*:?/gi,'Bilan de la séance'],
    [/\b(?:Ce que ça montre|Ce que cela montre|Observations?)\s*:?/gi,'Ce que ça montre'],
    [/\b(?:Impact sur le plan|Impact on the plan|Conséquence pour le plan)\s*:?/gi,'Impact sur le plan'],
    [/\b(?:À surveiller|A surveiller|Recommandation|Recommendation|Points? de vigilance)\s*:?/gi,'À surveiller']
  ];
  for(const [rx,label] of aliases)raw=raw.replace(rx,`\n${label}: `);
  const lines=raw.split('\n').map(x=>x.trim()).filter(Boolean);
  const found=[];let current=null;
  for(const line of lines){
    const match=headings.find(([title])=>line.toLowerCase().startsWith(title.toLowerCase()));
    if(match){
      if(current)found.push(current);
      current={title:match[0],icon:match[1],text:line.slice(match[0].length).replace(/^\s*:\s*/,'').trim()};
    }else if(current)current.text=`${current.text} ${line}`.trim();
  }
  if(current)found.push(current);
  if(found.length>=2)return found.map(section=>({...section,text:section.text.trim()})).filter(x=>x.text);
  const sentences=activityV6Sentences(raw.replace(/\n/g,' '));
  if(!sentences.length)return [];
  const buckets=[
    {title:'Bilan de la séance',icon:'📊',text:sentences.slice(0,2).join(' ')},
    {title:'Ce que ça montre',icon:'↗',text:sentences.slice(2,4).join(' ')},
    {title:'Impact sur le plan',icon:'🗓️',text:sentences.slice(4,5).join(' ')},
    {title:'À surveiller',icon:'◉',text:sentences.slice(5).join(' ')}
  ].filter(x=>x.text);
  return buckets.length?buckets:[{title:'Bilan de la séance',icon:'📊',text:raw}];
}
function polishActivityV6(text=null){
  ensureActivityV6Styles();
  const target=document.querySelector('#activityCoachAnalysis');if(!target)return;
  const raw=String(text??target.textContent??'').trim();
  if(!raw||/Analyse française en préparation|Analyse…/i.test(raw))return;
  const sections=activityV6Sections(raw);if(!sections.length)return;
  target.classList.add('activity-v6');
  target.innerHTML=sections.map(section=>`<div class="activity-v6-section"><div class="activity-v6-head"><span>${section.icon}</span><span>${activityV6Esc(section.title)}</span></div><p>${activityV6Esc(section.text)}</p></div>`).join('');
}
async function refreshActivityAnalysisV6(){
  const target=document.querySelector('#activityCoachAnalysis');if(!target)return;
  ensureActivityV6Styles();
  const existing=target.textContent?.trim();if(existing)polishActivityV6(existing);
  if(typeof ensureFrenchActivityAnalysis!=='function')return;
  if(!existing||/Activité synchronisée|Analyse française en préparation|Key findings|Heart rate averaged|Impact on the plan/i.test(existing)){
    target.classList.add('activity-v6');
    target.innerHTML='<div class="activity-v6-loading"><span class="activity-v6-dot"></span><span>Le Coach reformule l’analyse…</span></div>';
  }
  try{const analysis=await ensureFrenchActivityAnalysis();if(analysis)polishActivityV6(analysis);else if(existing)polishActivityV6(existing);}catch(error){console.error('Activity polish v6',error);if(existing)polishActivityV6(existing);}
}
document.addEventListener('click',event=>{
  if(event.target.closest('#viewActivityButton,#activityDetail .more-button,[data-open-activity]')){
    setTimeout(refreshActivityAnalysisV6,80);setTimeout(refreshActivityAnalysisV6,900);
  }
},true);
setTimeout(()=>{ensureActivityV6Styles();polishActivityV6();},1400);

async function refreshCorosDateV4Once(){
  const marker='coach-coros-activity-date-parser-v4';
  if(localStorage.getItem(marker))return;
  try{
    const statusResponse=await fetch('/api/coros/status',{cache:'no-store'}),status=await statusResponse.json();
    if(!statusResponse.ok||!status.connected)return;
    const syncResponse=await fetch('/api/coros/sync',{method:'POST'}),sync=await syncResponse.json();
    if(!syncResponse.ok)throw new Error(sync.error||'Synchronisation COROS impossible');
    localStorage.setItem(marker,new Date().toISOString());
    if(typeof safeReload==='function')await safeReload();
  }catch(error){console.warn('COROS date parser refresh',error);}
}
setTimeout(refreshCorosDateV4Once,2400);
