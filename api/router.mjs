import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { createPersonalizedPlan, normalizeObjectivePayload, refreshPlanPhase } from './plan-engine.mjs';

const bundledState = new URL('../data/state.json', import.meta.url);
const tmpState = path.join(os.tmpdir(), 'coach-coros-state.json');

async function readState() {
  try { return JSON.parse(await readFile(tmpState, 'utf8')); }
  catch {
    const initial = JSON.parse(await readFile(bundledState, 'utf8'));
    await writeFile(tmpState, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
}
async function saveState(state) { await writeFile(tmpState, JSON.stringify(state, null, 2), 'utf8'); }
function localDateIso() {
  return new Intl.DateTimeFormat('en-CA', {timeZone: process.env.APP_TIMEZONE || 'Europe/Paris',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
}
function daysToDate(date) {
  if (!date) return null;
  const today = new Date(`${localDateIso()}T00:00:00Z`), target = new Date(`${date}T00:00:00Z`);
  return Math.max(0, Math.ceil((target - today) / 86400000));
}
function addDaysIso(dateIso, days) { const d=new Date(`${dateIso}T12:00:00Z`); d.setUTCDate(d.getUTCDate()+days); return d.toISOString().slice(0,10); }
function dayLabel(dateIso) { return ['Dim','Lun','Mar','Mer','Jeu','Ven','Sam'][new Date(`${dateIso}T12:00:00Z`).getUTCDay()]; }

function legacySessionTemplate(dateIso, plan) {
  const weekday = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  const start = new Date(`${plan.startDate || dateIso}T12:00:00Z`), current = new Date(`${dateIso}T12:00:00Z`);
  const weekIndex = Math.max(0, Math.floor((current - start) / (7 * 86400000)));
  const longMinutes = Math.min(95, 60 + weekIndex * 5), easyMinutes = Math.min(55, 40 + weekIndex * 3);
  const base={id:`sess-${dateIso.replaceAll('-','')}`,date:dateIso,day:dayLabel(dateIso),status:'planned',generatedBy:'adaptive-plan-v1'};
  if (weekday===1) return {...base,sport:'Repos',title:'Repos / mobilité',duration:'20 min optionnel',details:'Mobilité douce uniquement si utile.',zone:1,zoneLabel:'Repos',hrTarget:'—',rpeTarget:'1/10',paceTarget:'—'};
  if (weekday===2) return {...base,sport:'Course à pied',title:'Séance spécifique',duration:'≈ 60 min',details:'Séance spécifique héritée du plan initial. Regénère le plan pour une personnalisation complète.',zone:3,zoneLabel:'Z3 → Z4',hrTarget:'Contrôlé',rpeTarget:'5–6/10',paceTarget:'Selon objectif'};
  if (weekday===3) return {...base,sport:'Gravel / vélo',title:'Récupération active',duration:'40–50 min',details:'Très facile.',zone:1,zoneLabel:'Z1',hrTarget:'Très facile',rpeTarget:'1–2/10',paceTarget:'FC prioritaire'};
  if (weekday===4) return {...base,sport:'Course à pied',title:'Endurance fondamentale',duration:`${easyMinutes}–${easyMinutes+5} min`,details:'Conversation fluide.',zone:2,zoneLabel:'Z2',hrTarget:'Endurance facile',rpeTarget:'2–3/10',paceTarget:'Libre'};
  if (weekday===5) return {...base,sport:'Vélo + renfo',title:'Endurance facile + renfo',duration:'60–75 min + 10 min',details:'Renforcement léger sans douleur.',zone:1,zoneLabel:'Z1 → Z2',hrTarget:'Facile',rpeTarget:'2–3/10',paceTarget:'—'};
  if (weekday===6) return {...base,sport:'Course à pied',title:'Sortie longue facile',duration:`${longMinutes}–${longMinutes+5} min`,details:'Reste patient et régulier.',zone:2,zoneLabel:'Z2',hrTarget:'Endurance facile',rpeTarget:'2–3/10',paceTarget:'Libre'};
  return {...base,sport:'Gravel',title:'Endurance aérobie',duration:'1 h 30–2 h',details:'Volume sans impact à intensité facile.',zone:2,zoneLabel:'Z2',hrTarget:'Endurance facile',rpeTarget:'2–3/10',paceTarget:'—'};
}

function ensurePlanCoverage(state, horizonDays=14) {
  const activeObjective=state.objectives?.find(o=>o.status==='active');
  const plan=activeObjective?state.plans?.find(p=>p.id===activeObjective.planId):state.plans?.find(p=>p.status==='active');
  if(!plan) return false;
  if(plan.generatedBy==='personalized-plan-v2') return refreshPlanPhase(plan, localDateIso());
  plan.sessions ||= [];
  const today=localDateIso(), horizon=addDaysIso(today,horizonDays), end=activeObjective?.date && activeObjective.date<horizon?activeObjective.date:horizon;
  const dates=new Set(plan.sessions.map(s=>s.date).filter(Boolean)); let changed=false;
  for(let date=today;date<=end;date=addDaysIso(date,1)) if(!dates.has(date)){plan.sessions.push(legacySessionTemplate(date,plan));dates.add(date);changed=true;}
  plan.sessions.sort((a,b)=>String(a.date||'').localeCompare(String(b.date||'')));
  return changed;
}

function activeContext(state) {
  const activeObjective=(state.objectives||[]).find(o=>o.status==='active')||null;
  const activePlan=activeObjective?(state.plans||[]).find(p=>p.id===activeObjective.planId)||null:(state.plans||[]).find(p=>p.status==='active')||null;
  const todayIso=localDateIso();
  const todaySession=activePlan?.sessions?.find(s=>s.date===todayIso)||null;
  const latestActivity=[...(state.activities||[])].sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')))[0]||null;
  return {activeObjective,activePlan,todaySession,latestActivity,todayIso};
}
function findSession(state,id){for(const plan of state.plans||[]){const session=(plan.sessions||[]).find(x=>x.id===id);if(session)return{plan,session};}return null;}

function adaptationFor(session, reason, note='') {
  const signal=`${reason||''} ${note||''}`.toLowerCase(), proposed={...session}; delete proposed.completedAt; proposed.status='planned';
  let explanation='On garde l’objectif de la séance mais on réduit le coût de fatigue.';
  if(/gêne|douleur|pain|bless/.test(signal)){Object.assign(proposed,{sport:'Repos actif / mobilité',title:'Récupération sans impact',duration:'20–30 min',details:'Mobilité douce ou marche uniquement si la gêne reste légère. Arrête si la douleur augmente.',zone:1,zoneLabel:'Très facile',hrTarget:'—',rpeTarget:'1–2/10',paceTarget:'—'});explanation='Une gêne prime sur la performance : on retire l’impact et l’intensité aujourd’hui.';}
  else if(/peu de temps|temps|court|30 min|press/.test(signal)){proposed.duration='30 min';proposed.details=/blocs|allure|seuil/i.test(session.title)?'10 min facile + 2×5 min au stimulus principal, récup 3 min + retour au calme.':'5 min très facile + 20 min dans la zone cible + 5 min de retour au calme.';explanation='On conserve le stimulus principal en compressant la séance à 30 minutes.';}
  else if(/jambes lourdes|lourdes|courbature/.test(signal)){Object.assign(proposed,{sport:'Gravel / vélo',title:'Décrassage jambes lourdes',duration:'35–45 min',details:'Pédalage très souple, sans force. Reste très facile.',zone:1,zoneLabel:'Z1',hrTarget:'Très facile',rpeTarget:'1–2/10',paceTarget:'FC prioritaire'});explanation='On remplace l’impact par du mouvement facile pour favoriser la récupération.';}
  else if(/fatigu|sommeil|épuis|crevé/.test(signal)){Object.assign(proposed,{sport:'Gravel / vélo',title:'Récupération active',duration:'30–40 min',details:'Très facile. Si la fatigue est générale ou inhabituelle, transforme simplement en repos.',zone:1,zoneLabel:'Z1',hrTarget:'Très facile',rpeTarget:'1–2/10',paceTarget:'FC prioritaire'});explanation='La fatigue du jour justifie de réduire nettement la charge sans casser la continuité.';}
  else if(/très bien|super|forme|excellent/.test(signal)){proposed.details=`${session.details||''} Si les sensations restent excellentes, ajoute seulement 5–10 min très faciles à la fin.`.trim();explanation='Même avec de très bonnes sensations, on ne transforme pas une bonne journée en surcharge.';}
  return {proposed,explanation};
}

function dashboard(state) {
  const ctx=activeContext(state);
  return {...state,activeObjective:ctx.activeObjective,activePlan:ctx.activePlan,todaySession:ctx.todaySession,latestActivity:ctx.latestActivity,meta:{today:ctx.todayIso,daysToObjective:daysToDate(ctx.activeObjective?.date),corosMode:process.env.COROS_MODE||'demo',openAiMode:process.env.OPENAI_API_KEY?'connected':'demo',persistence:'temporary-vercel-demo',adaptivePlan:true,planEngine:ctx.activePlan?.generatedBy||'legacy'}};
}

function activateObjectiveAndPlan(state, objective, plan) {
  for(const o of state.objectives||[]) if(o.id!==objective.id && o.status==='active') o.status='planned';
  for(const p of state.plans||[]) if(p.id!==plan?.id && p.status==='active') p.status='paused';
  objective.status='active'; if(plan) plan.status='active';
}

async function coachReply(state,userMessage){
  ensurePlanCoverage(state); const {activeObjective,activePlan,todaySession,latestActivity,todayIso}=activeContext(state);
  if(!process.env.OPENAI_API_KEY)return `Mode démo : j'ai reçu « ${userMessage} ». Ton objectif actif est « ${activeObjective?.title||'aucun objectif actif'} ».`;
  const corosLive=(process.env.COROS_MODE||'demo')!=='demo';
  const context={athlete:state.athlete,heartRateZones:state.heartRateZones,metrics:corosLive?state.metrics:null,dataFreshness:{today:todayIso,corosLive,note:corosLive?'Les métriques COROS peuvent être utilisées comme état du jour.':"COROS n'est pas synchronisé : ne pas utiliser les anciennes métriques de démonstration comme état actuel."},activeObjective,activePlan,todaySession,latestActivity,recentFeedback:(state.feedback||[]).slice(0,8)};
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'content-type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-5.6-luna',reasoning:{effort:'low'},input:`Tu es Coach COROS, coach d'endurance prudent dans une application multi-objectifs.\nContexte JSON:\n${JSON.stringify(context)}\nMessage de l'athlète: ${userMessage}\nRéponds en français, de façon concise et pratique. Prévention des blessures avant la performance. Pour les séances faciles, la fréquence cardiaque ou l'aisance priment. Si dataFreshness.corosLive est faux, ne présente jamais les métriques de démonstration comme actuelles.`})});
  if(!response.ok)throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  const data=await response.json(); return (data.output||[]).flatMap(i=>i.content||[]).filter(i=>i.type==='output_text').map(i=>i.text).join('\n').trim()||'Pas de réponse.';
}
function json(body,status=200){return Response.json(body,{status,headers:{'cache-control':'no-store'}});}

export default {
  async fetch(request){
    try{
      const url=new URL(request.url), route=url.searchParams.get('path')||'', method=request.method.toUpperCase(), state=await readState();
      state.objectives ||= []; state.plans ||= []; state.activities ||= []; state.feedback ||= []; state.coachMessages ||= [];

      if(method==='GET'&&route==='dashboard'){if(ensurePlanCoverage(state))await saveState(state);return json(dashboard(state));}
      if(method==='GET'&&route==='coros/status')return json({mode:process.env.COROS_MODE||'demo',connected:Boolean(process.env.COROS_ACCESS_TOKEN),note:'Les métriques sont masquées tant qu’une vraie synchronisation COROS n’est pas active.'});

      if(method==='POST'&&route==='objectives'){
        const payload=await request.json(), normalized=normalizeObjectivePayload(payload);
        if(!normalized.title)return json({error:"Nom de l'objectif requis"},400);
        if(!normalized.sport)return json({error:'Sport requis'},400);
        if(normalized.date && normalized.date<localDateIso())return json({error:'La date cible doit être dans le futur.'},400);
        if(/course|trail/i.test(normalized.sport) && !normalized.distanceKm)return json({error:'Distance requise pour un objectif de course ou trail.'},400);
        const objective={id:`obj-${crypto.randomUUID()}`,...normalized,status:normalized.activateNow?'active':'planned',planId:null,createdAt:new Date().toISOString()};
        const plan=await createPersonalizedPlan({state,objective,fitnessContext:payload._fitnessContext||null});
        objective.planId=plan.id; plan.objectiveId=objective.id; plan.status=objective.status==='active'?'active':'draft';
        if(objective.status==='active')activateObjectiveAndPlan(state,objective,plan);
        state.objectives.unshift(objective); state.plans.unshift(plan); await saveState(state);
        return json({ok:true,objective,plan,generation:{engine:'personalized-plan-v2',mode:plan.generationMode}},201);
      }

      let match=route.match(/^objectives\/([^/]+)\/regenerate$/);
      if(method==='POST'&&match){
        const id=decodeURIComponent(match[1]), objective=state.objectives.find(o=>o.id===id); if(!objective)return json({error:'Objectif introuvable'},404);
        const oldPlan=state.plans.find(p=>p.id===objective.planId)||null, payload=await request.json().catch(()=>({}));
        const plan=await createPersonalizedPlan({state,objective,fitnessContext:payload._fitnessContext||null,existingPlan:oldPlan});
        if(oldPlan)Object.assign(oldPlan,plan,{id:oldPlan.id,objectiveId:objective.id,status:objective.status==='active'?'active':oldPlan.status});
        else{objective.planId=plan.id;state.plans.unshift(plan);}
        await saveState(state); return json({ok:true,objective,plan:oldPlan||plan,generation:{engine:'personalized-plan-v2',mode:(oldPlan||plan).generationMode}});
      }

      match=route.match(/^objectives\/([^/]+)$/);
      if(method==='DELETE'&&match){
        const id=decodeURIComponent(match[1]), index=state.objectives.findIndex(o=>o.id===id); if(index<0)return json({error:'Objectif introuvable'},404);
        const [objective]=state.objectives.splice(index,1), planIndex=state.plans.findIndex(p=>p.id===objective.planId), plan=planIndex>=0?state.plans.splice(planIndex,1)[0]:null;
        const removedSessionIds=new Set((plan?.sessions||[]).map(s=>s.id));
        state.adaptationProposals=(state.adaptationProposals||[]).filter(p=>!removedSessionIds.has(p.sessionId));
        if(objective.status==='active'){
          const next=state.objectives.find(o=>o.status==='planned')||null;
          if(next){const nextPlan=state.plans.find(p=>p.id===next.planId)||null;activateObjectiveAndPlan(state,next,nextPlan);ensurePlanCoverage(state);}
        }
        await saveState(state); return json({ok:true,deletedObjectiveId:id,deletedPlanId:plan?.id||null});
      }

      match=route.match(/^plans\/([^/]+)$/);
      if(method==='DELETE'&&match){
        const id=decodeURIComponent(match[1]), plan=state.plans.find(p=>p.id===id); if(!plan)return json({error:'Plan introuvable'},404);
        const objective=state.objectives.find(o=>o.planId===id); if(objective)return json({error:'Supprime l’objectif associé pour supprimer ce plan sans laisser un objectif orphelin.'},409);
        state.plans=state.plans.filter(p=>p.id!==id); await saveState(state); return json({ok:true,deletedPlanId:id});
      }

      match=route.match(/^objectives\/([^/]+)\/activate$/);
      if(method==='POST'&&match){const id=decodeURIComponent(match[1]),objective=state.objectives.find(o=>o.id===id);if(!objective)return json({error:'Objectif introuvable'},404);const plan=state.plans.find(p=>p.id===objective.planId)||null;activateObjectiveAndPlan(state,objective,plan);ensurePlanCoverage(state);await saveState(state);return json({ok:true,activeObjective:objective,activePlan:plan});}
      match=route.match(/^objectives\/([^/]+)\/complete$/);
      if(method==='POST'&&match){const id=decodeURIComponent(match[1]),objective=state.objectives.find(o=>o.id===id);if(!objective)return json({error:'Objectif introuvable'},404);objective.status='completed';objective.completedAt=new Date().toISOString();const plan=state.plans.find(p=>p.id===objective.planId);if(plan)plan.status='completed';await saveState(state);return json({ok:true,objective});}

      match=route.match(/^sessions\/([^/]+)\/complete$/);
      if(method==='POST'&&match){const found=findSession(state,decodeURIComponent(match[1]));if(!found)return json({error:'Séance introuvable'},404);found.session.status='completed';found.session.completedAt=new Date().toISOString();await saveState(state);return json({ok:true,session:found.session});}
      match=route.match(/^sessions\/([^/]+)\/adapt$/);
      if(method==='POST'&&match){const id=decodeURIComponent(match[1]),found=findSession(state,id);if(!found)return json({error:'Séance introuvable'},404);if(found.session.status==='completed')return json({error:'Une séance terminée ne peut plus être adaptée.'},409);const payload=await request.json(),{proposed,explanation}=adaptationFor(found.session,payload.reason,payload.note);const proposal={id:crypto.randomUUID(),sessionId:found.session.id,createdAt:new Date().toISOString(),status:'proposed',reason:explanation,userReason:payload.reason||'',note:payload.note||'',original:{title:found.session.title,sport:found.session.sport,duration:found.session.duration,hrTarget:found.session.hrTarget,rpeTarget:found.session.rpeTarget},proposed:{title:proposed.title,sport:proposed.sport,duration:proposed.duration,details:proposed.details,zone:proposed.zone,zoneLabel:proposed.zoneLabel,hrTarget:proposed.hrTarget,rpeTarget:proposed.rpeTarget,paceTarget:proposed.paceTarget}};state.adaptationProposals||=[];state.adaptationProposals.unshift(proposal);await saveState(state);return json({ok:true,proposal});}
      match=route.match(/^sessions\/([^/]+)\/adapt\/apply$/);
      if(method==='POST'&&match){const id=decodeURIComponent(match[1]),found=findSession(state,id);if(!found)return json({error:'Séance introuvable'},404);const payload=await request.json(),proposal=(state.adaptationProposals||[]).find(x=>x.id===payload.proposalId&&x.sessionId===id);if(!proposal)return json({error:'Proposition introuvable'},404);if(proposal.status!=='proposed')return json({error:'Cette proposition a déjà été traitée.'},409);const original={...found.session};Object.assign(found.session,proposal.proposed,{adaptedAt:new Date().toISOString(),adaptedFrom:original,adaptationReason:proposal.userReason||proposal.reason});proposal.status='applied';proposal.appliedAt=new Date().toISOString();await saveState(state);return json({ok:true,session:found.session,proposal});}

      if(method==='POST'&&route==='feedback'){const payload=await request.json();for(const key of ['rpe','legs','cardio','pain','couldContinue'])if(payload[key]===undefined||payload[key]==='')return json({error:`Champ manquant: ${key}`},400);const{activeObjective,activePlan,latestActivity}=activeContext(state),activityId=payload.activityId||latestActivity?.id||null,sessionId=payload.sessionId||null;if(!activityId&&!sessionId)return json({error:'Aucune activité ou séance à commenter'},400);const item={id:crypto.randomUUID(),at:new Date().toISOString(),activityId,sessionId,objectiveId:activeObjective?.id||null,planId:activePlan?.id||null,...payload};state.feedback.unshift(item);await saveState(state);return json({ok:true,feedback:item},201);}
      if(method==='POST'&&route==='coach'){const{message}=await request.json();if(!message?.trim())return json({error:'Message vide'},400);ensurePlanCoverage(state);const reply=await coachReply(state,message.trim());state.coachMessages.unshift({at:new Date().toISOString(),text:reply});await saveState(state);return json({reply});}
      return json({error:`Route API inconnue: ${route}`},404);
    }catch(error){return json({error:error?.message||'Erreur serveur'},500);}
  }
};
