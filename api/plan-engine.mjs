import crypto from 'node:crypto';

const DAY_MS = 86400000;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function localDateIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}
function dateObj(iso) { return new Date(`${iso}T12:00:00Z`); }
function addDays(iso, days) { const d=dateObj(iso); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
function daysBetween(a,b) { return Math.max(0, Math.round((dateObj(b)-dateObj(a))/DAY_MS)); }
function dayLabel(iso) { return ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][dateObj(iso).getUTCDay()]; }
function weekday(iso) { return dateObj(iso).getUTCDay(); }

function parseDurationMinutes(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number') return value;
  const s = String(value).trim();
  let m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) return Number(m[1])*60 + Number(m[2]) + Number(m[3]||0)/60;
  m = s.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*(?:min|m))?/i);
  if (m && (m[1] || m[2])) return Number(m[1]||0)*60 + Number(m[2]||0);
  const n = Number(s.replace(',','.'));
  return Number.isFinite(n) ? n : null;
}
function parsePaceSeconds(value) {
  if (!value) return null;
  const m = String(value).match(/(\d{1,2})\s*[:']\s*(\d{2})/);
  return m ? Number(m[1])*60 + Number(m[2]) : null;
}
function formatPace(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded/60)}:${String(rounded%60).padStart(2,'0')} /km`;
}
function formatDuration(totalMinutes) {
  const mins = Math.max(1, Math.round(totalMinutes));
  const h = Math.floor(mins/60), m = mins%60;
  return h ? `${h} h${m ? ` ${String(m).padStart(2,'0')}` : ''}` : `${m} min`;
}
function hrRange(zones, zoneNo, fallback) {
  const z=(zones||[]).find(item=>Number(item.zone)===zoneNo);
  return z?.range || fallback;
}
function normalizeSport(value) {
  const s=String(value||'Course à pied').toLowerCase();
  if (s.includes('trail')) return 'Trail';
  if (s.includes('gravel')) return 'Gravel';
  if (s.includes('vélo') || s.includes('velo')) return 'Vélo de route';
  if (s.includes('forme')) return 'Forme générale';
  return 'Course à pied';
}

export function normalizeObjectivePayload(payload = {}) {
  const sport = normalizeSport(payload.sport);
  const distanceKm = num(String(payload.distanceKm ?? '').replace(',','.'));
  const hours = clamp(num(payload.targetHours) || 0, 0, 99);
  const minutes = clamp(num(payload.targetMinutes) || 0, 0, 59);
  const targetDurationMinutes = hours*60 + minutes || parseDurationMinutes(payload.targetDuration) || null;
  const targetPaceSeconds = distanceKm && targetDurationMinutes ? (targetDurationMinutes*60)/distanceKm : parsePaceSeconds(payload.targetPace);
  const sessionsPerWeek = clamp(Math.round(num(payload.sessionsPerWeek) || 4), 2, 7);
  const date = payload.date || null;
  const today = localDateIso();
  const requestedStart = /^\d{4}-\d{2}-\d{2}$/.test(String(payload.startDate||'')) ? String(payload.startDate) : today;
  const startDate = requestedStart < today ? today : (date && requestedStart > date ? date : requestedStart);
  const title = String(payload.title || '').trim();
  return {
    title,
    sport,
    type: payload.type?.trim() || (/course|trail/i.test(sport) ? 'Course' : 'Objectif'),
    eventName: String(payload.eventName || title).trim(),
    date,
    startDate,
    distanceKm: distanceKm && distanceKm > 0 ? Math.round(distanceKm*100)/100 : null,
    targetDurationMinutes,
    target: targetDurationMinutes ? formatDuration(targetDurationMinutes) : String(payload.target || '').trim(),
    targetPace: targetPaceSeconds ? formatPace(targetPaceSeconds) : String(payload.targetPace || '').trim(),
    targetPaceSeconds,
    sessionsPerWeek,
    preferredLongDay: Number.isInteger(Number(payload.preferredLongDay)) ? Number(payload.preferredLongDay) : 6,
    notes: String(payload.notes || payload.goalNotes || '').trim(),
    activateNow: payload.activateNow !== false && payload.activateNow !== 'false' && payload.activateNow !== '0'
  };
}

function fitnessSnapshot(state, fitnessContext = null) {
  const metrics = fitnessContext?.metrics || state.metrics || {};
  const zones = fitnessContext?.heartRateZones || state.heartRateZones || {};
  const latest = fitnessContext?.latestActivity || [...(state.activities||[])].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0] || null;
  const recentFeedback = fitnessContext?.recentFeedback || fitnessContext?.feedback || (state.feedback||[]).slice(0,8);
  const latestMinutes = parseDurationMinutes(latest?.duration) || 45;
  const latestPace = parsePaceSeconds(latest?.pace);
  const recovery = num(metrics.recovery);
  const loadRatio = num(metrics.loadRatio);
  const pain = recentFeedback.some(item => item?.pain && !['none','Aucune'].includes(item.pain));
  const conservative = pain || (recovery !== null && recovery < 55) || (loadRatio !== null && loadRatio > 1.3);
  const underloaded = loadRatio !== null && loadRatio < 0.75;
  return {
    metrics, zones, latestActivity: latest, recentFeedback,
    latestMinutes, latestPace, recovery, loadRatio, pain, conservative, underloaded,
    injuryNotes: state.athlete?.injuryNotes || '', availability: state.athlete?.availability || '', sports: state.athlete?.sports || []
  };
}

function phaseForWeek(index, total) {
  const remaining = total - index;
  if (remaining <= 1) return 'Affûtage';
  if (remaining <= Math.max(2, Math.ceil(total*0.25))) return 'Spécifique';
  if (index < Math.max(1, Math.floor(total*0.3))) return 'Base';
  return 'Développement';
}

function scheduleWeekdays(count, preferredLongDay = 6) {
  const longDay = clamp(preferredLongDay,0,6);
  const templates = {
    2: [2,longDay], 3: [2,4,longDay], 4: [2,4,longDay,0],
    5: [1,2,4,longDay,0], 6: [1,2,3,4,longDay,0], 7: [1,2,3,4,5,longDay,0]
  };
  const unique=[];
  for (const d of templates[count] || templates[4]) if (!unique.includes(d)) unique.push(d);
  for (let d=0; unique.length<count && d<7; d++) if (!unique.includes(d)) unique.push(d);
  return unique.slice(0,count).sort((a,b)=>a-b);
}

function runningSession({date, slotIndex, slots, weekIndex, totalWeeks, phase, objective, fit}) {
  const isLong = slotIndex === slots.length-1 || weekday(date) === objective.preferredLongDay;
  const isQuality = slotIndex === (slots.length >= 3 ? 1 : 0) && !isLong;
  const isRecovery = slots.length >= 5 && slotIndex === 0;
  const isCross = slots.length >= 4 && slotIndex === slots.length-1 && !isLong;
  const progress = totalWeeks <= 1 ? 1 : weekIndex/(totalWeeks-1);
  const deload = (weekIndex+1)%4===0 && phase !== 'Affûtage';
  const baseEasy = clamp(Math.round(fit.latestMinutes*0.9),35,55);
  const easyMin = Math.round((baseEasy + progress*10) * (deload ? 0.85 : 1) * (fit.conservative ? 0.9 : 1));
  const startLong = clamp(Math.round(fit.latestMinutes*1.25),50,85);
  const longCap = objective.distanceKm && objective.targetPaceSeconds ? clamp(Math.round((objective.distanceKm*objective.targetPaceSeconds/60)*0.82),70,130) : 110;
  const longMin = Math.round(clamp(startLong + weekIndex*6, startLong, longCap) * (deload ? 0.8 : 1) * (fit.conservative ? 0.9 : 1));
  const z1=hrRange(fit.zones?.zones,1,'Très facile');
  const z2=hrRange(fit.zones?.zones,2,'Endurance facile / conversation');
  const z3=hrRange(fit.zones?.zones,3,'Soutenu contrôlé');
  const z4=hrRange(fit.zones?.zones,4,'Seuil contrôlé');
  const targetPace = objective.targetPaceSeconds;
  const thresholdPace = parsePaceSeconds(fit.metrics?.thresholdPace);
  const eventLabel = objective.distanceKm ? `${String(objective.distanceKm).replace('.',',')} km` : objective.eventName || 'objectif';
  const base={id:`sess-${crypto.randomUUID()}`,date,day:dayLabel(date),status:'planned',generatedBy:'personalized-plan-v2',phase};

  if (phase === 'Affûtage') {
    if (isLong) return {...base,sport:'Course à pied',title:'Endurance légère',duration:`${Math.max(35,Math.round(longMin*0.6))} min`,details:'Volume réduit pour arriver frais. Reste facile et termine avec de bonnes jambes.',zone:2,zoneLabel:'Z2',hrTarget:z2,rpeTarget:'2–3/10',paceTarget:'Libre'};
    if (isQuality && targetPace) return {...base,sport:'Course à pied',title:`Rappel allure ${eventLabel}`,duration:'40–50 min',details:`Échauffement facile puis 3×4 min autour de ${formatPace(targetPace)} avec récupération complète. Aucun effort maximal.`,zone:3,zoneLabel:'Z3',hrTarget:z3,rpeTarget:'4–5/10',paceTarget:formatPace(targetPace)};
  }
  if (isRecovery) return {...base,sport:'Gravel / vélo',title:'Récupération active',duration:'30–45 min',details:'Très facile, sans contrainte. Transforme en repos complet si la fatigue ou une gêne augmente.',zone:1,zoneLabel:'Z1',hrTarget:z1,rpeTarget:'1–2/10',paceTarget:'FC prioritaire'};
  if (isLong) return {...base,sport:'Course à pied',title:phase==='Spécifique'?`Sortie longue spécifique ${eventLabel}`:'Sortie longue facile',duration:`${longMin} min`,details:phase==='Spécifique'&&targetPace?`Majoritairement facile. Si les sensations restent bonnes, termine 15–25 min proche de ${formatPace(targetPace+10)} sans dépasser l'effort prévu.`:'Construis le temps d’endurance sans chercher l’allure. Hydrate-toi et reste régulier.',zone:2,zoneLabel:'Z2',hrTarget:z2,rpeTarget:phase==='Spécifique'?'3–4/10':'2–3/10',paceTarget:phase==='Spécifique'&&targetPace?`${formatPace(targetPace+10)} en fin de séance`:'Libre'};
  if (isQuality) {
    if (phase==='Base') return {...base,sport:'Course à pied',title:'Fartlek contrôlé',duration:`${Math.max(45,easyMin+10)} min`,details:'Échauffement facile puis 6×2 min soutenues mais propres, récupération 2 min facile. Objectif : économie de course, pas épuisement.',zone:3,zoneLabel:'Z3',hrTarget:z3,rpeTarget:'4–5/10',paceTarget:'Soutenu contrôlé'};
    if (phase==='Développement') {
      const pace=thresholdPace || (targetPace ? targetPace-15 : null);
      return {...base,sport:'Course à pied',title:'Blocs au seuil contrôlé',duration:'55–65 min',details:`15 min faciles + 3×8 min ${pace?`autour de ${formatPace(pace)}`:'à effort seuil contrôlé'}, récup 3 min + retour au calme.`,zone:4,zoneLabel:'Z3 → Z4',hrTarget:z4,rpeTarget:'5–6/10',paceTarget:pace?formatPace(pace):'RPE 5–6'};
    }
    const pace=targetPace || thresholdPace;
    return {...base,sport:'Course à pied',title:`Blocs allure ${eventLabel}`,duration:'55–70 min',details:`15 min faciles + 4×6 min ${pace?`autour de ${formatPace(pace)}`:'à l’allure cible'}, récup 3 min + 10 min faciles.`,zone:3,zoneLabel:'Z3 → bas Z4',hrTarget:z3,rpeTarget:'5–6/10',paceTarget:pace?formatPace(pace):'Allure cible'};
  }
  if (isCross) return {...base,sport:'Vélo + renfo',title:'Endurance croisée + renforcement',duration:'50–70 min + 10 min',details:'Endurance facile sans impact puis renforcement léger. Respecte les zones de vigilance du profil et évite tout mouvement douloureux.',zone:2,zoneLabel:'Z1 → Z2',hrTarget:z2,rpeTarget:'2–3/10',paceTarget:'—'};
  return {...base,sport:'Course à pied',title:'Endurance fondamentale',duration:`${easyMin}–${easyMin+5} min`,details:'Conversation fluide. La fréquence cardiaque et les sensations priment sur l’allure.',zone:2,zoneLabel:'Z2',hrTarget:z2,rpeTarget:'2–3/10',paceTarget:'Libre'};
}

function cyclingSession(ctx) {
  const {date,slotIndex,slots,weekIndex,totalWeeks,phase,objective,fit}=ctx;
  const isLong=slotIndex===slots.length-1 || weekday(date)===objective.preferredLongDay;
  const isQuality=slotIndex===1 && slots.length>=3;
  const progress=totalWeeks<=1?1:weekIndex/(totalWeeks-1);
  const z2=hrRange(fit.zones?.zones,2,'Endurance facile');
  const base={id:`sess-${crypto.randomUUID()}`,date,day:dayLabel(date),status:'planned',generatedBy:'personalized-plan-v2',phase,sport:objective.sport};
  if(isLong)return {...base,title:'Sortie endurance longue',duration:formatDuration(clamp(90+progress*75,90,180)),details:'Volume progressif en aisance. Hydratation et alimentation régulières.',zone:2,zoneLabel:'Z2',hrTarget:z2,rpeTarget:'2–3/10',paceTarget:'—'};
  if(isQuality&&phase!=='Base'&&phase!=='Affûtage')return {...base,title:'Tempo / seuil contrôlé',duration:'60–75 min',details:'Échauffement puis 3×10 min soutenues et régulières, récupération 5 min facile. Reste en contrôle.',zone:3,zoneLabel:'Z3 → Z4',hrTarget:'Soutenu contrôlé',rpeTarget:'5–6/10',paceTarget:'—'};
  return {...base,title:phase==='Affûtage'?'Endurance légère':'Endurance aérobie',duration:phase==='Affûtage'?'40–50 min':'50–75 min',details:'Intensité facile et régulière. Termine frais.',zone:2,zoneLabel:'Z2',hrTarget:z2,rpeTarget:'2–3/10',paceTarget:'—'};
}

function generalSession(ctx) {
  const base=runningSession({...ctx, objective:{...ctx.objective,sport:'Course à pied'}});
  if(ctx.slotIndex%2===0) return {...base,sport:'Renforcement / mobilité',title:'Renforcement fonctionnel',duration:'30–40 min',details:'Renforcement global technique, charge modérée, aucune douleur. Termine par mobilité.',zone:1,zoneLabel:'Technique',hrTarget:'—',rpeTarget:'3–4/10',paceTarget:'—'};
  return base;
}

function deterministicPlan(state, objective, fitnessContext, existingPlan = null) {
  const fit=fitnessSnapshot(state,fitnessContext);
  const today=localDateIso();
  const requestedStart=objective.startDate || existingPlan?.startDate || today;
  const start=existingPlan?.status==='active' ? today : (requestedStart>=today ? requestedStart : today);
  const end=objective.date && objective.date>=start ? objective.date : addDays(start,56);
  const totalDays=Math.max(1,daysBetween(start,end));
  const totalWeeks=Math.max(1,Math.ceil((totalDays+1)/7));
  const slots=scheduleWeekdays(objective.sessionsPerWeek,objective.preferredLongDay);
  const sessions=[];
  for(let weekIndex=0;weekIndex<totalWeeks;weekIndex++){
    const phase=phaseForWeek(weekIndex,totalWeeks);
    const weekStart=addDays(start,weekIndex*7);
    for(let offset=0;offset<7;offset++){
      const date=addDays(weekStart,offset);
      if(date>end) continue;
      const wd=weekday(date);
      if(!slots.includes(wd)) continue;
      if(date===objective.date) continue;
      const slotIndex=slots.indexOf(wd);
      const ctx={date,slotIndex,slots,weekIndex,totalWeeks,phase,objective,fit};
      const session=/vélo|velo|gravel/i.test(objective.sport)?cyclingSession(ctx):/forme générale/i.test(objective.sport)?generalSession(ctx):runningSession(ctx);
      sessions.push(session);
    }
  }
  if(objective.date){
    sessions.push({
      id:`sess-${crypto.randomUUID()}`,date:objective.date,day:dayLabel(objective.date),status:'planned',generatedBy:'personalized-plan-v2',phase:'Objectif',sport:objective.sport,
      title:objective.eventName||objective.title,duration:objective.targetDurationMinutes?formatDuration(objective.targetDurationMinutes):'Épreuve',
      details:`Jour de l’objectif. Départ contrôlé, stratégie régulière et priorité aux sensations.${objective.notes?` Consigne personnelle : ${objective.notes}`:''}`,
      zone:3,zoneLabel:'Course / objectif',hrTarget:'Selon stratégie',rpeTarget:'Progressif',paceTarget:objective.targetPace||'Selon objectif',isEvent:true
    });
  }
  sessions.sort((a,b)=>a.date.localeCompare(b.date));
  const past=existingPlan?.status==='active' ? (existingPlan?.sessions||[]).filter(s=>s.date<today) : [];
  const future=sessions.filter(s=>s.date>=start);
  const currentPhase=start>today?'À venir':phaseForWeek(0,totalWeeks);
  const caution=fit.conservative?'Charge actuelle ou ressenti récent invitant à démarrer prudemment. ':fit.underloaded?'Charge récente légère : progression volontairement graduelle. ':'';
  const principle=`${caution}Début du plan le ${start}. ${objective.sessionsPerWeek} séances/semaine, progression par phases jusqu’au ${objective.date||end}. ${objective.targetPace?`Allure cible ${objective.targetPace}. `:''}Les séances faciles restent guidées par la FC ou les sensations disponibles.`;
  return {
    id: existingPlan?.id || `plan-${crypto.randomUUID()}`,
    objectiveId: objective.id,
    name:`Plan · ${objective.title}`,
    status: objective.status==='active'?'active':'draft',
    startDate:start,endDate:end,totalWeeks,currentWeek:start>today?0:1,phase:currentPhase,principle,
    generatedBy:'personalized-plan-v2',generatedAt:new Date().toISOString(),generationMode:'rules',
    fitnessSnapshot:{recovery:fit.recovery,loadRatio:fit.loadRatio,vo2max:fit.metrics?.vo2max??null,latestActivity:fit.latestActivity?{date:fit.latestActivity.date,sport:fit.latestActivity.sport,distance:fit.latestActivity.distance,duration:fit.latestActivity.duration,pace:fit.latestActivity.pace,avgHr:fit.latestActivity.avgHr,maxHr:fit.latestActivity.maxHr}:null},
    sessions:[...past,...future]
  };
}

function extractText(payload) {
  return (payload.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n').trim();
}
function parseJsonText(text) {
  const cleaned=String(text||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');
  try{return JSON.parse(cleaned)}catch{}
  const a=cleaned.indexOf('{'),b=cleaned.lastIndexOf('}');
  if(a>=0&&b>a){try{return JSON.parse(cleaned.slice(a,b+1))}catch{}}
  return null;
}
function validateRefinement(base, refined) {
  if(!refined||!Array.isArray(refined.sessions))return null;
  const byDate=new Map(base.sessions.filter(s=>s.date>=base.startDate).map(s=>[s.date,s]));
  const safe=[];
  for(const item of refined.sessions){
    const original=byDate.get(item.date); if(!original) continue;
    safe.push({...original,
      title:String(item.title||original.title).slice(0,90), duration:String(item.duration||original.duration).slice(0,40),
      details:String(item.details||original.details).slice(0,500), hrTarget:String(item.hrTarget||original.hrTarget).slice(0,60),
      rpeTarget:String(item.rpeTarget||original.rpeTarget).slice(0,30), paceTarget:String(item.paceTarget||original.paceTarget).slice(0,80),
      zoneLabel:String(item.zoneLabel||original.zoneLabel).slice(0,40)
    });
  }
  if(safe.length<Math.max(2,Math.floor(byDate.size*0.75)))return null;
  const past=base.sessions.filter(s=>s.date<base.startDate);
  safe.sort((a,b)=>a.date.localeCompare(b.date));
  return {...base,principle:String(refined.principle||base.principle).slice(0,800),phase:String(refined.phase||base.phase).slice(0,80),generationMode:'ai+rules',sessions:[...past,...safe]};
}

async function refinePlanWithAi(state, objective, fitnessContext, basePlan) {
  if(!process.env.OPENAI_API_KEY)return basePlan;
  const fit=fitnessSnapshot(state,fitnessContext);
  const context={objective,athlete:state.athlete,metrics:fit.metrics,heartRateZones:fit.zones,latestActivity:fit.latestActivity,recentFeedback:fit.recentFeedback,basePlan:{...basePlan,sessions:basePlan.sessions.filter(s=>s.date>=basePlan.startDate)}};
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch('https://api.openai.com/v1/responses',{
      method:'POST',signal:controller.signal,headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},
      body:JSON.stringify({model:process.env.OPENAI_PLAN_MODEL||process.env.OPENAI_MODEL||'gpt-5.6-luna',reasoning:{effort:'medium'},input:`Tu construis un plan d'entraînement d'endurance personnalisé et prudent.\nContexte JSON:\n${JSON.stringify(context)}\n\nRègles impératives:\n- Réponds UNIQUEMENT avec un objet JSON valide.\n- Conserve exactement les mêmes dates et le même nombre de séances que basePlan.\n- Ne crée jamais deux séances dures consécutives.\n- Respecte sessionsPerWeek, les douleurs/vigilances du profil et la condition actuelle.\n- Les footings faciles sont pilotés par FC quand des zones sont disponibles, sinon par aisance/RPE.\n- L'objectif, sa distance, son temps et son allure cible doivent influencer les séances spécifiques.\n- Le plan précédent n'est qu'un historique, ne recopie pas ses séances.\nFormat: {"principle":"...","phase":"...","sessions":[{"date":"YYYY-MM-DD","title":"...","duration":"...","details":"...","hrTarget":"...","rpeTarget":"...","paceTarget":"...","zoneLabel":"..."}]}`})
    });
    if(!response.ok)return basePlan;
    const parsed=parseJsonText(extractText(await response.json()));
    return validateRefinement(basePlan,parsed)||basePlan;
  } finally {
    clearTimeout(timeout);
  }
}

export async function createPersonalizedPlan({state, objective, fitnessContext=null, existingPlan=null}) {
  const base=deterministicPlan(state,objective,fitnessContext,existingPlan);
  try{return await refinePlanWithAi(state,objective,fitnessContext,base)}catch{return base;}
}

export function refreshPlanPhase(plan, today = localDateIso()) {
  if(!plan?.startDate||!/personalized-plan-v[23]/.test(plan.generatedBy||''))return false;
  const total=plan.totalWeeks||1;
  const beforeStart=today<plan.startDate;
  const current=beforeStart?0:clamp(Math.floor(daysBetween(plan.startDate,today)/7)+1,1,total);
  const phase=beforeStart?'À venir':phaseForWeek(current-1,total);
  let changed=false;
  if(plan.currentWeek!==current){plan.currentWeek=current;changed=true;}
  if(plan.phase!==phase){plan.phase=phase;changed=true;}
  return changed;
}