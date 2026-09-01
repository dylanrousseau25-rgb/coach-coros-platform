import crypto from 'node:crypto';

const DAY_MS = 86400000;
const todayIso = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: process.env.APP_TIMEZONE || 'Europe/Paris', year:'numeric', month:'2-digit', day:'2-digit'
}).format(new Date());
const dateObj = iso => new Date(`${iso}T12:00:00Z`);
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
const num = value => { const n=Number(value); return Number.isFinite(n)?n:null; };

function weekKey(iso, startIso) {
  return Math.max(0, Math.floor((dateObj(iso)-dateObj(startIso))/(7*DAY_MS)));
}

export function defaultPlanPreferences(objective = {}, plan = {}) {
  const sessions = clamp(Number(objective.sessionsPerWeek || plan.preferences?.sessionsPerWeek || 4), 2, 7);
  const running = /course|trail/i.test(objective.sport || '');
  const trail = /trail/i.test(objective.sport || '');
  return {
    sessionsPerWeek: sessions,
    runSessionsPerWeek: running ? clamp(Number(plan.preferences?.runSessionsPerWeek || Math.min(3, sessions)), 2, sessions) : 0,
    strengthPerWeek: running ? clamp(Number(plan.preferences?.strengthPerWeek ?? 1), 0, 2) : 1,
    crossTrainingAllowed: plan.preferences?.crossTrainingAllowed ?? true,
    hillsAllowed: plan.preferences?.hillsAllowed ?? running,
    hardSessionsMax: clamp(Number(plan.preferences?.hardSessionsMax || (trail ? 2 : 2)), 1, 3),
    volumeLevel: clamp(Number(plan.preferences?.volumeLevel || 3), 1, 5),
    difficultyLevel: clamp(Number(plan.preferences?.difficultyLevel || 3), 1, 5),
    longRunMaxMinutes: clamp(Number(plan.preferences?.longRunMaxMinutes || (trail ? 180 : 130)), 60, 300),
    preferredLongDay: Number.isInteger(Number(objective.preferredLongDay)) ? Number(objective.preferredLongDay) : Number(plan.preferences?.preferredLongDay ?? 6),
    availableDays: Array.isArray(plan.preferences?.availableDays) && plan.preferences.availableDays.length
      ? [...new Set(plan.preferences.availableDays.map(Number).filter(n=>n>=0&&n<=6))]
      : [0,1,2,3,4,5,6],
    athleteNote: String(plan.preferences?.athleteNote || objective.notes || '').trim()
  };
}

export function normalizePlanPreferences(input = {}, objective = {}, current = {}) {
  const base = {...defaultPlanPreferences(objective,{preferences:current}),...current};
  const sessions = clamp(Number(input.sessionsPerWeek ?? base.sessionsPerWeek),2,7);
  const availableDays = Array.isArray(input.availableDays)
    ? [...new Set(input.availableDays.map(Number).filter(n=>n>=0&&n<=6))]
    : base.availableDays;
  return {
    ...base,
    sessionsPerWeek: sessions,
    runSessionsPerWeek: /course|trail/i.test(objective.sport||'')
      ? clamp(Number(input.runSessionsPerWeek ?? base.runSessionsPerWeek),2,sessions) : 0,
    strengthPerWeek: clamp(Number(input.strengthPerWeek ?? base.strengthPerWeek),0,2),
    crossTrainingAllowed: input.crossTrainingAllowed === undefined ? base.crossTrainingAllowed : Boolean(input.crossTrainingAllowed),
    hillsAllowed: input.hillsAllowed === undefined ? base.hillsAllowed : Boolean(input.hillsAllowed),
    hardSessionsMax: clamp(Number(input.hardSessionsMax ?? base.hardSessionsMax),1,3),
    volumeLevel: clamp(Number(input.volumeLevel ?? base.volumeLevel),1,5),
    difficultyLevel: clamp(Number(input.difficultyLevel ?? base.difficultyLevel),1,5),
    longRunMaxMinutes: clamp(Number(input.longRunMaxMinutes ?? base.longRunMaxMinutes),60,300),
    preferredLongDay: clamp(Number(input.preferredLongDay ?? base.preferredLongDay),0,6),
    availableDays: availableDays.length ? availableDays : base.availableDays,
    athleteNote: String(input.athleteNote ?? base.athleteNote ?? '').trim()
  };
}

function parseDurationMax(value) {
  const values = String(value||'').match(/\d+/g)?.map(Number) || [];
  if (!values.length) return null;
  if (/h/i.test(String(value)) && values.length <= 2) return values[0]*60 + (values[1]||0);
  return Math.max(...values);
}
function setDuration(session, minutes) { return {...session,duration:`${Math.max(20,Math.round(minutes))} min`}; }
function isRun(session){ return /course|trail/i.test(`${session.sport||''} ${session.title||''}`); }
function isHard(session){ return /seuil|tempo|allure|fartlek|interval|côte|cote|spécifique/i.test(session.title||''); }
function isLong(session){ return /longue|sortie longue/i.test(session.title||''); }
function isEasy(session){ return /endurance fondamentale|facile|récupération/i.test(session.title||'') && !isLong(session); }
function strengthSession(base, trail=false) { return {...base,sport:'Renforcement',title:trail?'Renforcement trail · jambes & tronc':'Renforcement coureur · force utile',duration:'30–40 min',zone:1,zoneLabel:'Technique',hrTarget:'—',rpeTarget:'3–4/10',paceTarget:'—',details:trail?'Chevilles, mollets, fessiers, ischios et tronc. Technique propre, aucune douleur, charge progressive.':'Chaîne postérieure, mollets, fessiers et tronc. Technique propre, aucune douleur et jamais jusqu’à l’échec.',sessionRole:'strength',generatedBy:'personalized-plan-v3'}; }
function crossSession(base) { return {...base,sport:'Gravel / vélo',title:'Endurance croisée',duration:'50–75 min',zone:2,zoneLabel:'Z1 → Z2',hrTarget:'Endurance facile',rpeTarget:'2–3/10',paceTarget:'FC prioritaire',details:'Développe le moteur aérobie sans ajouter d’impact. Pédalage souple et régulier, termine frais.',sessionRole:'cross-training',generatedBy:'personalized-plan-v3'}; }
function hillsSession(base,objective,weekIndex){const trail=/trail/i.test(objective.sport||'');return{...base,sport:trail?'Trail / course à pied':'Course à pied',title:trail?'Côtes trail · puissance & technique':'Côtes courtes contrôlées',duration:weekIndex<2?'45–55 min':'50–60 min',zone:4,zoneLabel:'Z3 → Z4',hrTarget:'Effort contrôlé',rpeTarget:'5–7/10',paceTarget:'Effort / pente',details:trail?'Échauffement facile puis répétitions en côte en travaillant posture, cadence et relance. Descente contrôlée, pas d’effort maximal.':'15 min faciles puis 8–10 × 45–60 s en côte, récupération en redescendant, puis retour au calme. Reste puissant mais propre.',sessionRole:'hills',generatedBy:'personalized-plan-v3'};}
const volumeFactor=level=>[0.82,0.91,1,1.07,1.14][clamp(Number(level),1,5)-1];

export function applyCollaborativePlanDesign(plan, objective, state = {}, preferencesInput = {}) {
  const prefs=normalizePlanPreferences(preferencesInput,objective,plan.preferences||{}),trail=/trail/i.test(objective.sport||''),running=/course|trail/i.test(objective.sport||''),today=todayIso();
  const future=(plan.sessions||[]).filter(s=>s.date>=today&&!s.isEvent),groups=new Map();
  for(const s of future){const k=weekKey(s.date,plan.startDate||today);if(!groups.has(k))groups.set(k,[]);groups.get(k).push({...s,generatedBy:'personalized-plan-v3'});}
  const redesigned=[];
  for(const[weekIndex,list0]of[...groups.entries()].sort((a,b)=>a[0]-b[0])){
    let list=list0.sort((a,b)=>a.date.localeCompare(b.date));if(list.length>prefs.sessionsPerWeek)list=list.slice(0,prefs.sessionsPerWeek);
    list=list.map(s=>{const max=parseDurationMax(s.duration);if(!max)return s;let target=max*volumeFactor(prefs.volumeLevel);if(isLong(s))target=Math.min(target,prefs.longRunMaxMinutes);return setDuration(s,target);});
    if(running){
      const longIndexes=list.map((s,i)=>isLong(s)?i:-1).filter(i=>i>=0);if(longIndexes.length>1){const preferred=longIndexes.find(i=>new Date(`${list[i].date}T12:00:00Z`).getUTCDay()===prefs.preferredLongDay)??longIndexes[0];for(const i of longIndexes)if(i!==preferred)list[i]={...list[i],title:'Endurance fondamentale',details:'Séance facile complémentaire. Une seule sortie longue est conservée cette semaine.',duration:'40–55 min',zone:2,zoneLabel:'Z2',hrTarget:'Endurance facile',rpeTarget:'2–3/10',paceTarget:'Libre',sessionRole:'easy',generatedBy:'personalized-plan-v3'};}
      if(prefs.hillsAllowed&&list.length>=3&&(trail||weekIndex%2===0)){let idx=list.findIndex(s=>isHard(s)&&!isLong(s));if(idx<0)idx=list.findIndex(s=>isEasy(s)&&!isLong(s));if(idx>=0)list[idx]=hillsSession(list[idx],objective,weekIndex);}
      let hardSeen=0;list=list.map(s=>{if(!isHard(s))return s;hardSeen++;if(hardSeen<=prefs.hardSessionsMax)return s;return{...s,title:'Endurance fondamentale',details:'Séance volontairement facile pour respecter la limite de séances exigeantes.',zone:2,zoneLabel:'Z2',hrTarget:'Endurance facile',rpeTarget:'2–3/10',paceTarget:'Libre',sessionRole:'easy'};});
      for(let n=0;n<prefs.strengthPerWeek;n++){const current=list.filter(s=>/renfo/i.test(`${s.sport} ${s.title}`)).length;if(current>n)continue;let idx=list.findIndex((s,i)=>isRun(s)&&isEasy(s)&&!isLong(s)&&i>0);if(idx<0)idx=list.findIndex(s=>isRun(s)&&!isLong(s)&&!isHard(s));if(idx>=0)list[idx]=strengthSession(list[idx],trail);}
      if(prefs.crossTrainingAllowed){let runs=list.filter(isRun).length;while(runs>prefs.runSessionsPerWeek){let idx=-1;for(let i=list.length-1;i>=0;i--)if(isRun(list[i])&&isEasy(list[i])&&!isLong(list[i])){idx=i;break;}if(idx<0)break;list[idx]=crossSession(list[idx]);runs--;}}
      list=list.map(s=>isHard(s)?{...s,coachDifficulty:prefs.difficultyLevel,rpeTarget:prefs.difficultyLevel<=2?'4–5/10':prefs.difficultyLevel>=5?'6–7/10':s.rpeTarget}:s);
    }
    redesigned.push(...list);
  }
  const event=(plan.sessions||[]).filter(s=>s.isEvent);plan.sessions=[...(plan.sessions||[]).filter(s=>s.date<today&&!s.isEvent),...redesigned,...event].sort((a,b)=>a.date.localeCompare(b.date));plan.generatedBy='personalized-plan-v3';plan.preferences=prefs;plan.designSummary={sessionsPerWeek:prefs.sessionsPerWeek,runSessionsPerWeek:prefs.runSessionsPerWeek,strengthPerWeek:prefs.strengthPerWeek,crossTrainingAllowed:prefs.crossTrainingAllowed,hillsAllowed:prefs.hillsAllowed,hardSessionsMax:prefs.hardSessionsMax,rationale:buildRationale(objective,prefs,state)};return plan;
}

export function buildRationale(objective,prefs,state={}){const bits=[];if(/course|trail/i.test(objective.sport||'')){bits.push(`${prefs.runSessionsPerWeek} sorties course en moyenne`);if(prefs.strengthPerWeek)bits.push(`${prefs.strengthPerWeek} renforcement/semaine`);if(prefs.crossTrainingAllowed)bits.push('vélo/gravel utilisé pour compléter l’aérobie sans ajouter d’impact');if(prefs.hillsAllowed)bits.push(/trail/i.test(objective.sport||'')?'côtes intégrées régulièrement pour le dénivelé et la technique':'côtes intégrées comme stimulus de force/économie de course');}const recovery=num(state.metrics?.recovery),ratio=num(state.metrics?.loadRatio);if(recovery!==null&&recovery<60)bits.push('départ prudent car la récupération récente est basse');if(ratio!==null&&ratio>1.25)bits.push('volume contenu car la charge récente est déjà élevée');if(state.athlete?.injuryNotes)bits.push('renforcement et progressivité adaptés aux points de vigilance du profil');return bits.join(' · ')+'.';}
export function planDiff(oldPlan,newPlan,fromDate=todayIso()){const before=new Map((oldPlan?.sessions||[]).filter(s=>s.date>=fromDate).map(s=>[s.date,s])),after=new Map((newPlan?.sessions||[]).filter(s=>s.date>=fromDate).map(s=>[s.date,s])),dates=[...new Set([...before.keys(),...after.keys()])].sort();return dates.map(date=>{const a=before.get(date),b=after.get(date);if(!a)return{date,type:'added',after:compactSession(b)};if(!b)return{date,type:'removed',before:compactSession(a)};const keys=['title','sport','duration','hrTarget','rpeTarget','paceTarget'];if(keys.every(k=>String(a[k]??'')===String(b[k]??'')))return null;return{date,type:'changed',before:compactSession(a),after:compactSession(b)};}).filter(Boolean);}
function compactSession(s){return s?{id:s.id,date:s.date,title:s.title,sport:s.sport,duration:s.duration,hrTarget:s.hrTarget,rpeTarget:s.rpeTarget,paceTarget:s.paceTarget,phase:s.phase}:null;}
export function createPlanVersion(state,plan,{reason='Mise à jour du plan',summary='',diff=[]}={}){state.planVersions||=[];const previous=state.planVersions.filter(v=>v.planId===plan.id).sort((a,b)=>b.version-a.version)[0],version={id:`pv-${crypto.randomUUID()}`,planId:plan.id,objectiveId:plan.objectiveId,version:(previous?.version||0)+1,at:new Date().toISOString(),reason,summary,diff:diff.slice(0,80),preferences:plan.preferences||null};state.planVersions.unshift(version);plan.version=version.version;plan.lastChangeReason=reason;plan.lastChangedAt=version.at;return version;}
export function weeklyReview(state,objective,plan,fitnessContext=null){const today=todayIso(),currentWeek=Math.max(0,weekKey(today,plan.startDate||today)),reviewWeek=Math.max(0,currentWeek-1),start=new Date(dateObj(plan.startDate||today).getTime()+reviewWeek*7*DAY_MS).toISOString().slice(0,10),end=new Date(dateObj(start).getTime()+6*DAY_MS).toISOString().slice(0,10),weekSessions=(plan.sessions||[]).filter(s=>s.date>=start&&s.date<=end&&!s.isEvent),completed=weekSessions.filter(s=>s.status==='completed').length,completionRate=weekSessions.length?completed/weekSessions.length:0,feedback=(state.feedback||[]).filter(f=>{const d=String(f.at||'').slice(0,10);return d>=start&&d<=end;}),avgRpe=feedback.length?feedback.reduce((sum,f)=>sum+(Number(f.rpe)||0),0)/feedback.length:null,pain=feedback.some(f=>f.pain&&f.pain!=='none'&&f.pain!=='Aucune'),metrics=fitnessContext?.metrics||state.metrics||{},recovery=num(metrics.recovery),ratio=num(metrics.loadRatio);let direction='maintain',volumeDelta=0,difficultyDelta=0;const reasons=[];if(pain||(recovery!==null&&recovery<55)||(ratio!==null&&ratio>1.3)){direction='reduce';volumeDelta=-1;difficultyDelta=-1;if(pain)reasons.push('une gêne/douleur a été signalée');if(recovery!==null&&recovery<55)reasons.push(`récupération basse (${Math.round(recovery)}%)`);if(ratio!==null&&ratio>1.3)reasons.push('charge récente élevée');}else if(completionRate>=.8&&(avgRpe===null||avgRpe<=6)&&(recovery===null||recovery>=70)){direction='progress';volumeDelta=1;reasons.push('semaine bien réalisée et correctement absorbée');}else if(completionRate<.6){direction='reduce';volumeDelta=-1;reasons.push('plusieurs séances n’ont pas été réalisées');}else reasons.push('la charge et les sensations justifient de conserver la progression actuelle');const prefs=normalizePlanPreferences({volumeLevel:clamp((plan.preferences?.volumeLevel||3)+volumeDelta,1,5),difficultyLevel:clamp((plan.preferences?.difficultyLevel||3)+difficultyDelta,1,5)},objective,plan.preferences||{});return{id:`review-${crypto.randomUUID()}`,planId:plan.id,objectiveId:objective.id,createdAt:new Date().toISOString(),status:'proposed',type:'weekly-review',week:{index:reviewWeek+1,start,end,planned:weekSessions.length,completed,completionRate:Math.round(completionRate*100),avgRpe:avgRpe?Math.round(avgRpe*10)/10:null},direction,reasons,proposedPreferences:prefs,summary:direction==='progress'?'Le Coach propose une progression légère pour la suite du plan.':direction==='reduce'?'Le Coach propose d’alléger la suite pour mieux absorber la charge.':'Le Coach recommande de conserver la trajectoire actuelle.'};}
export function preferenceRecommendation(current,next,fitnessContext={}){const metrics=fitnessContext?.metrics||{},recovery=num(metrics.recovery),ratio=num(metrics.loadRatio),warnings=[];if(next.sessionsPerWeek>current.sessionsPerWeek+1)warnings.push('augmentation de plus d’une séance/semaine');if(next.volumeLevel>current.volumeLevel+1)warnings.push('hausse de volume importante');if(next.hardSessionsMax>2)warnings.push('plus de deux séances difficiles par semaine');if(recovery!==null&&recovery<60&&(next.volumeLevel>current.volumeLevel||next.difficultyLevel>current.difficultyLevel))warnings.push('récupération actuelle basse');if(ratio!==null&&ratio>1.25&&next.volumeLevel>current.volumeLevel)warnings.push('charge récente déjà élevée');return{recommended:warnings.length===0,warnings,summary:warnings.length?`Le Coach te conseille de rester plus prudent : ${warnings.join(', ')}.`:'Ces ajustements restent cohérents avec une progression prudente.'};}
