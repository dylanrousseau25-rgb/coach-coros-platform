import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const bundledState = new URL('../data/state.json', import.meta.url);
const tmpState = path.join(os.tmpdir(), 'coach-coros-state.json');

async function readState(){
  try{return JSON.parse(await readFile(tmpState,'utf8'));}
  catch{const initial=JSON.parse(await readFile(bundledState,'utf8'));await writeFile(tmpState,JSON.stringify(initial,null,2),'utf8');return initial;}
}
async function saveState(state){await writeFile(tmpState,JSON.stringify(state,null,2),'utf8');}

function corosFamily(sportType){
  const n=Number(sportType);
  if(n>=100&&n<=104)return'run';
  if(n>=200&&n<=205)return'cycle';
  if(n===402)return'strength';
  if(n===900)return'walk';
  if(n===901)return'cardio';
  return'other';
}
function sessionFamilies(session){
  const text=`${session?.sport||''} ${session?.title||''}`.toLowerCase();
  const out=new Set();
  if(/course|trail|fartlek|seuil|allure|interval|côte|cote/.test(text))out.add('run');
  if(/vélo|velo|gravel|vtt|cycl/.test(text))out.add('cycle');
  if(/renfo|muscu|force|gainage/.test(text))out.add('strength');
  if(/marche/.test(text))out.add('walk');
  if(/repos|mobilité|mobilite/.test(text))out.add('rest');
  return out;
}
export function compatibleActivitySession(activity,session){
  if(!activity?.date||!session?.date||activity.date!==session.date)return false;
  if(session.isEvent||/repos/.test(String(session.sport||'').toLowerCase()))return false;
  const family=corosFamily(activity.sportType),families=sessionFamilies(session);
  if(family==='other'||!families.size)return false;
  if(families.has(family))return true;
  if(family==='walk'&&families.has('rest'))return true;
  return false;
}

export async function reconcileCorosActivities(activities=[]){
  const state=await readState();state.objectives||=[];state.plans||=[];
  const activeObjective=state.objectives.find(o=>o.status==='active')||null;
  const plan=activeObjective?state.plans.find(p=>p.id===activeObjective.planId)||null:state.plans.find(p=>p.status==='active')||null;
  if(!plan)return{matched:[],unmatched:(activities||[]).length,reason:'no-active-plan'};
  plan.sessions||=[];
  const matched=[],usedSessions=new Set();
  const refs=[...(activities||[])].filter(a=>a?.date&&a?.labelId).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
  for(const activity of refs){
    const candidates=plan.sessions.filter(session=>!usedSessions.has(session.id)&&compatibleActivitySession(activity,session));
    if(candidates.length!==1)continue;
    const session=candidates[0];usedSessions.add(session.id);
    const wasCompleted=session.status==='completed';
    session.corosMatch={activityId:activity.id||`coros-${activity.labelId}`,labelId:activity.labelId,sportType:activity.sportType,date:activity.date,matchedAt:new Date().toISOString()};
    if(!wasCompleted){
      session.status='completed';
      session.completedAt=new Date().toISOString();
      session.completionSource='coros-auto';
    }else if(!session.completionSource){
      session.completionSource='manual+coros';
    }
    matched.push({sessionId:session.id,activityId:session.corosMatch.activityId,date:activity.date,autoCompleted:!wasCompleted});
  }
  if(matched.length)await saveState(state);
  return{matched,matchedCount:matched.length,unmatched:Math.max(0,refs.length-matched.length),activePlanId:plan.id};
}

export async function restorePocExtras(payload={}){
  const state=await readState();
  if(Array.isArray(payload.feedback))state.feedback=payload.feedback.slice(0,200);
  if(Array.isArray(payload.coachMessages))state.coachMessages=payload.coachMessages.slice(0,120);
  await saveState(state);
  return{ok:true,feedbackCount:(state.feedback||[]).length,coachMessageCount:(state.coachMessages||[]).length};
}

export async function auditPocState(){
  const state=await readState();
  const activeObjectives=(state.objectives||[]).filter(o=>o.status==='active');
  const activePlans=(state.plans||[]).filter(p=>p.status==='active');
  const orphanObjectives=(state.objectives||[]).filter(o=>o.planId&&!(state.plans||[]).some(p=>p.id===o.planId));
  const orphanPlans=(state.plans||[]).filter(p=>p.objectiveId&&!(state.objectives||[]).some(o=>o.id===p.objectiveId));
  return{
    ok:activeObjectives.length<=1&&activePlans.length<=1&&!orphanObjectives.length&&!orphanPlans.length,
    activeObjectives:activeObjectives.length,activePlans:activePlans.length,
    orphanObjectiveIds:orphanObjectives.map(o=>o.id),orphanPlanIds:orphanPlans.map(p=>p.id),
    feedbackCount:(state.feedback||[]).length
  };
}
