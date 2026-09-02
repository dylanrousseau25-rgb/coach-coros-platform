const DAY_MS=86400000;
const HALF_KM=21.0975;
function num(v){const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function dateObj(iso){return new Date(`${iso}T12:00:00Z`);}
function daysBetween(a,b){if(!a||!b)return 0;return Math.max(0,Math.round((dateObj(b)-dateObj(a))/DAY_MS));}
function parsePaceSeconds(value){if(!value)return null;const m=String(value).match(/(\d{1,2})\s*[:']\s*(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null;}
function parseMinutes(value){
  if(value==null||value==='')return null;if(typeof value==='number')return value;
  const s=String(value).trim();let m=s.match(/(\d{1,2}):(\d{2}):(\d{2})/);if(m)return Number(m[1])*60+Number(m[2])+Number(m[3])/60;
  m=s.match(/(\d{1,2}):(\d{2})/);if(m){const a=Number(m[1]),b=Number(m[2]);return a<=10?a*60+b:a+b/60;}
  m=s.match(/(\d+)\s*h(?:\s*(\d+)\s*(?:min|m)?)?/i);if(m)return Number(m[1])*60+Number(m[2]||0);
  m=s.match(/(\d+)\s*(?:min|m)\b/i);if(m)return Number(m[1]);
  return null;
}
function parseDistanceKm(value){if(value==null)return null;const m=String(value).replace(',','.').match(/\d+(?:\.\d+)?\s*km/i)||String(value).replace(',','.').match(/\d+(?:\.\d+)?/);return m?Number(String(m[0]).match(/\d+(?:\.\d+)?/)[0]):null;}
function formatMinutes(value){if(!Number.isFinite(value))return null;const total=Math.max(1,Math.round(value));const h=Math.floor(total/60),m=total%60;return h?`${h} h ${String(m).padStart(2,'0')}`:`${m} min`;}
function formatPace(seconds){if(!Number.isFinite(seconds)||seconds<=0)return null;const s=Math.round(seconds);return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')} /km`;}
function riegel(minutes,d1,d2){if(!minutes||!d1||!d2)return null;return minutes*Math.pow(d2/d1,1.06);}
function objectiveDistance(objective){return num(objective.distanceKm)||parseDistanceKm(objective.eventName)||parseDistanceKm(objective.title);}
function objectiveTargetMinutes(objective,distance){const direct=num(objective.targetDurationMinutes)||parseMinutes(objective.target);if(direct)return direct;const pace=parsePaceSeconds(objective.targetPace);return pace&&distance?pace*distance/60:null;}
function vdotRaceMinutes(vdot,distanceKm){
  if(!vdot||!distanceKm)return null;
  let lo=Math.max(10,distanceKm*2.2),hi=Math.max(lo+1,distanceKm*12);
  const score=t=>{const v=distanceKm*1000/t;const vo2=-4.60+0.182258*v+0.000104*v*v;const pct=0.8+0.1894393*Math.exp(-0.012778*t)+0.2989558*Math.exp(-0.1932605*t);return vo2/pct;};
  for(let i=0;i<80;i++){const mid=(lo+hi)/2;if(score(mid)>vdot)lo=mid;else hi=mid;}
  return (lo+hi)/2;
}
function thresholdEstimate(pace,distance){if(!pace||!distance)return null;let adj;if(distance<=5)adj=-15;else if(distance<=10)adj=-5;else if(distance<=HALF_KM)adj=10;else if(distance<=42.3)adj=30;else adj=45;return distance*(pace+adj)/60;}
function preparationPotential(weeks,sessions,conservative){let p=weeks>=16?.04:weeks>=12?.035:weeks>=9?.025:weeks>=6?.015:weeks>=4?.0075:0;if(sessions<=2)p*=.55;else if(sessions>=5)p*=1.1;if(conservative)p*=.45;return clamp(p,0,.045);}
function roundMinute(v){return Math.max(1,Math.round(v));}
function sourceEstimate(state,objective){
  const live=state?.meta?.corosMode==='mcp';const metrics=live?(state.metrics||{}):{};const d=objectiveDistance(objective);const estimates=[];
  const half=parseMinutes(metrics.halfPrediction);if(half&&d)estimates.push({name:'prédiction COROS semi',minutes:riegel(half,HALF_KM,d),weight:.58});
  const threshold=parsePaceSeconds(metrics.thresholdPace);if(threshold&&d)estimates.push({name:'allure seuil COROS',minutes:thresholdEstimate(threshold,d),weight:.30});
  const vo2=num(metrics.vo2max);if(vo2&&d)estimates.push({name:'VO₂max COROS',minutes:vdotRaceMinutes(vo2,d),weight:.18});
  if(!estimates.length){const a=state.latestActivity||null,ad=parseDistanceKm(a?.distance),at=parseMinutes(a?.duration);if(ad&&at&&ad>=3&&d)estimates.push({name:'dernière activité',minutes:riegel(at,ad,d)*.96,weight:.22,weak:true});}
  const valid=estimates.filter(x=>Number.isFinite(x.minutes)&&x.minutes>0);if(!valid.length)return{minutes:null,sources:[]};
  const weight=valid.reduce((s,x)=>s+x.weight,0);return{minutes:valid.reduce((s,x)=>s+x.minutes*x.weight,0)/weight,sources:valid};
}
export function assessGoalFeasibility(state={},objective={}){
  const today=state?.meta?.today||new Date().toISOString().slice(0,10),start=objective.startDate||today,end=objective.date||null,d=objectiveDistance(objective),target=objectiveTargetMinutes(objective,d),weeks=end?Math.max(0,Math.ceil(daysBetween(start,end)/7)):0,sessions=Number(objective.sessionsPerWeek||4);
  const live=state?.meta?.corosMode==='mcp',recovery=live?num(state.metrics?.recovery):null,ratio=live?num(state.metrics?.loadRatio):null,feedback=state.feedback||[],pain=feedback.slice(0,8).some(f=>f?.pain&&!['none','Aucune','aucune'].includes(String(f.pain))),conservative=pain||(recovery!==null&&recovery<55)||(ratio!==null&&ratio>1.3);
  const estimate=sourceEstimate(state,{...objective,distanceKm:d}),current=estimate.minutes,potential=preparationPotential(weeks,sessions,conservative),prepared=current?current*(1-potential):null;
  const confidence=estimate.sources.length>=2?'élevée':estimate.sources.some(s=>!s.weak)?'moyenne':estimate.sources.length?'faible':'insuffisante';
  const reasons=[];if(weeks)reasons.push(`${weeks} semaine${weeks>1?'s':''} de préparation disponible${weeks<5?' : marge de progression limitée':''}.`);if(estimate.sources.length)reasons.push(`Estimation basée sur ${estimate.sources.map(s=>s.name).join(' + ')}.`);else reasons.push('Pas assez de données COROS fiables pour estimer précisément le chrono actuel.');if(conservative)reasons.push('La récupération, la charge ou un ressenti récent invite à rester prudent.');if(sessions<=2)reasons.push('Deux séances par semaine limitent la vitesse de progression possible.');
  if(/trail/i.test(objective.sport||'')&&!objective.elevationGain){reasons.push('Pour un trail, le dénivelé et le terrain manquent : le chrono ne peut être évalué précisément.');return{status:'insufficient',label:'À préciser',decision:'needs-data',confidence:'faible',targetMinutes:target,currentEstimateMinutes:current,recommendedTargetMinutes:prepared?roundMinute(prepared):null,recommendedRange:prepared?[roundMinute(prepared*.98),roundMinute(prepared*1.05)]:null,weeks,sessions,reasons,summary:'Objectif trail plausible à évaluer, mais il manque le dénivelé/terrain pour juger le chrono.',targetPace:objective.targetPace||null};}
  if(!target){return{status:'finish-goal',label:'Objectif de finir',decision:'go',confidence,currentEstimateMinutes:current,recommendedTargetMinutes:prepared?roundMinute(prepared):null,recommendedRange:prepared?[roundMinute(prepared*.98),roundMinute(prepared*1.05)]:null,weeks,sessions,reasons,summary:'Sans chrono cible, le Coach construira surtout le plan pour terminer la distance dans de bonnes conditions.',targetPace:null};}
  if(!prepared){return{status:'insufficient',label:'Données insuffisantes',decision:'needs-data',confidence,targetMinutes:target,currentEstimateMinutes:null,recommendedTargetMinutes:null,recommendedRange:null,weeks,sessions,reasons,summary:'Je peux construire le plan, mais je n’ai pas assez de données fiables pour confirmer ce chrono.',targetPace:objective.targetPace||null};}
  const ratioTarget=target/prepared;let status,label,decision;if(ratioTarget>=1.04){status='comfortable';label='Prudent / réaliste';decision='go';}else if(ratioTarget>=.98){status='realistic';label='Réaliste';decision='go';}else if(ratioTarget>=.93){status='ambitious';label='Ambitieux';decision='caution';}else{status='too-aggressive';label='Trop agressif actuellement';decision='adjust';}
  const recommended=roundMinute(prepared),range=[roundMinute(prepared*.98),roundMinute(prepared*1.05)];const delta=Math.round((1-ratioTarget)*100);if(status==='ambitious')reasons.push(`Le chrono demandé est environ ${Math.max(1,delta)} % plus rapide que l’estimation préparée.`);if(status==='too-aggressive')reasons.push(`Le chrono demandé est environ ${Math.max(1,delta)} % plus rapide que ce que les données actuelles rendent raisonnable.`);
  const summary=status==='too-aggressive'?`Le Coach déconseille ce chrono pour l’instant et viserait plutôt autour de ${formatMinutes(recommended)}.`:status==='ambitious'?`L’objectif est possible mais exigeant. Le Coach recommande de le réévaluer après quelques semaines.`:status==='comfortable'?`L’objectif laisse une marge raisonnable par rapport à ton niveau estimé.`:`L’objectif est cohérent avec ton niveau estimé et le temps de préparation disponible.`;
  return{status,label,decision,confidence,targetMinutes:target,currentEstimateMinutes:roundMinute(current),recommendedTargetMinutes:recommended,recommendedRange:range,weeks,sessions,reasons:reasons.slice(0,5),summary,targetPace:objective.targetPace||formatPace(target*60/d),estimatedPace:formatPace(recommended*60/d)};
}
export function feasibilityDisplay(assessment){return{...assessment,target:formatMinutes(assessment.targetMinutes),currentEstimate:formatMinutes(assessment.currentEstimateMinutes),recommendedTarget:formatMinutes(assessment.recommendedTargetMinutes),recommendedRange:assessment.recommendedRange?assessment.recommendedRange.map(formatMinutes):null};}
