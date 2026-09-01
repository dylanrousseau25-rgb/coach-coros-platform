let planV2WeekIndex = null;
let planV2Busy = false;

function planV2Escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function planV2Date(iso) { return new Date(`${iso}T12:00:00`); }
function planV2AddDays(iso, days) { const d=planV2Date(iso); d.setDate(d.getDate()+days); return d.toISOString().slice(0,10); }
function planV2FormatDate(iso, opts={day:'numeric',month:'short'}) { try{return new Intl.DateTimeFormat('fr-FR',opts).format(planV2Date(iso));}catch{return iso||'—';} }
function planV2SportEmoji(sport) { return /vélo|velo|gravel/i.test(sport||'')?'🚴':/repos|mobilité|renfo/i.test(sport||'')?'🧘':'🏃'; }

function ensurePlanV2Styles() {
  if (document.querySelector('#planV2Styles')) return;
  const style=document.createElement('style');
  style.id='planV2Styles';
  style.textContent=`
    .objective-v2-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .objective-time-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
    .objective-time-row input{text-align:center}
    .objective-v2-check{display:flex!important;flex-direction:row!important;align-items:center;gap:10px;padding:10px 0;color:#405879;font-weight:650}
    .objective-v2-check input{width:20px;height:20px;margin:0}
    .plan-v2-actions{display:grid;gap:10px;margin:14px 0 4px}
    .plan-v2-danger{border-color:#f2b8b5!important;color:#b3261e!important;background:#fff8f7!important}
    .plan-v2-status{text-align:center;color:#667895;font-size:.84rem;min-height:1.2em;margin:8px 0 0}
    .goal-list-item .plan-v2-mini-delete{margin-left:8px;border:0;background:transparent;color:#a34a45;font-size:.78rem;padding:5px 0}
    .plan-v2-engine{margin-top:10px;padding:10px 12px;border-radius:12px;background:#f5f8ff;color:#526987;font-size:.8rem;line-height:1.4}
    @media(max-width:380px){.objective-v2-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function ensureObjectiveV2Form() {
  const form=document.querySelector('#objectiveForm');
  if(!form || form.dataset.planV2Ready) return;
  form.dataset.planV2Ready='1';
  const dateLabel=document.querySelector('#objectiveDate')?.closest('label');
  if(dateLabel) dateLabel.insertAdjacentHTML('beforebegin',`
    <div class="objective-v2-grid" id="objectiveV2RaceFields">
      <label class="input-label">Distance (km)
        <input name="distanceKm" id="objectiveDistance" type="number" min="0.1" step="0.1" inputmode="decimal" placeholder="Ex. 21,1" />
      </label>
      <label class="input-label">Temps visé
        <span class="objective-time-row"><input name="targetHours" id="objectiveTargetHours" type="number" min="0" max="99" inputmode="numeric" placeholder="h" /><input name="targetMinutes" id="objectiveTargetMinutes" type="number" min="0" max="59" inputmode="numeric" placeholder="min" /></span>
      </label>
    </div>`);
  const sessionsLabel=document.querySelector('#objectiveSessions')?.closest('label');
  if(sessionsLabel) sessionsLabel.insertAdjacentHTML('afterend',`
    <label class="input-label">Jour préféré pour la séance longue
      <select name="preferredLongDay" id="objectiveLongDay"><option value="6">Samedi</option><option value="0">Dimanche</option><option value="5">Vendredi</option><option value="4">Jeudi</option><option value="3">Mercredi</option><option value="2">Mardi</option><option value="1">Lundi</option></select>
    </label>
    <label class="input-label">Consignes personnelles
      <textarea name="notes" id="objectiveNotes" rows="3" placeholder="Ex. priorité à finir frais, gêne à surveiller, jours compliqués…"></textarea>
    </label>
    <label class="objective-v2-check"><input type="checkbox" name="activateNow" id="objectiveActivateNow" checked /><span>Activer ce nouvel objectif et son plan</span></label>`);
  const oldTarget=document.querySelector('#objectiveTarget')?.closest('label');
  if(oldTarget) oldTarget.style.display='none';
  const create=document.querySelector('#createObjectiveButton');
  if(create) create.textContent='✦ Construire mon plan personnalisé';
}

async function createPersonalizedObjective(event) {
  event?.preventDefault(); event?.stopImmediatePropagation();
  if(planV2Busy) return;
  const form=document.querySelector('#objectiveForm'); if(!form) return;
  if(!form.reportValidity()) return;
  const values=Object.fromEntries(new FormData(form).entries());
  values.activateNow=document.querySelector('#objectiveActivateNow')?.checked !== false;
  const sport=values.sport||'';
  if(/course|trail/i.test(sport) && !Number(String(values.distanceKm||'').replace(',','.'))){
    document.querySelector('#objectiveDistance')?.focus();
    const status=document.querySelector('#objectiveStatus'); if(status) status.textContent='Indique la distance de l’objectif.';
    return;
  }
  planV2Busy=true;
  const button=document.querySelector('#createObjectiveButton'), status=document.querySelector('#objectiveStatus');
  const original=button?.textContent;
  if(button){button.disabled=true;button.textContent='Analyse du profil…';}
  if(status)status.textContent='Le Coach analyse l’objectif, ta condition COROS, ton historique et tes contraintes puis construit le plan…';
  try{
    const response=await fetch('/api/objectives',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(values)});
    const body=await response.json(); if(!response.ok)throw new Error(body.error||'Impossible de créer le plan');
    if(status)status.textContent=`Plan personnalisé construit ✓ · ${body.plan?.sessions?.length||0} séances · ${body.generation?.mode==='ai+rules'?'Coach IA + règles':'moteur personnalisé'}`;
    form.reset(); const activate=document.querySelector('#objectiveActivateNow'); if(activate)activate.checked=true;
    setTimeout(()=>document.querySelector('#objectiveDialog')?.close(),450);
    if(typeof safeReload==='function')await safeReload();
    planV2WeekIndex=0;
    await renderPlanV2CurrentWeek();
    if(typeof setScreen==='function')setScreen('plan');
    setTimeout(refreshPlanV2Management,100);
  }catch(error){console.error(error);if(status)status.textContent=error.message||'Erreur pendant la création du plan.';}
  finally{planV2Busy=false;if(button){button.disabled=false;button.textContent=original||'✦ Construire mon plan personnalisé';}}
}

function bindObjectiveV2Create() {
  const button=document.querySelector('#createObjectiveButton');
  if(!button || button.dataset.planV2Bound) return;
  button.dataset.planV2Bound='1';
  button.addEventListener('click',createPersonalizedObjective,{capture:true});
}

function goalTargetText(objective) {
  if(!objective)return '—';
  const pieces=[];
  if(objective.distanceKm)pieces.push(`${String(objective.distanceKm).replace('.',',')} km`);
  if(objective.target)pieces.push(objective.target);
  if(objective.targetPace)pieces.push(objective.targetPace);
  return pieces.join(' · ')||'Objectif sans chrono';
}

function ensurePlanV2GoalActions() {
  const content=document.querySelector('#goalDetail .detail-content');
  const activeCard=content?.querySelector('.goal-active-card');
  if(!content||!activeCard)return null;
  let actions=document.querySelector('#planV2GoalActions');
  if(!actions){
    actions=document.createElement('div'); actions.id='planV2GoalActions'; actions.className='plan-v2-actions';
    actions.innerHTML=`<button class="button soft full" id="regeneratePlanV2Button" type="button">✦ Reconstruire ce plan avec le Coach</button><button class="button ghost full plan-v2-danger" id="deleteObjectiveV2Button" type="button">Supprimer cet objectif et son plan</button><p class="plan-v2-status" id="planV2ManagementStatus"></p>`;
    activeCard.insertAdjacentElement('afterend',actions);
    actions.querySelector('#regeneratePlanV2Button').addEventListener('click',regenerateActivePlanV2);
    actions.querySelector('#deleteObjectiveV2Button').addEventListener('click',deleteActiveObjectiveV2);
  }
  return actions;
}

async function regenerateActivePlanV2() {
  if(planV2Busy)return;
  const data=await getDashboardSnapshot(), objective=data.activeObjective;
  if(!objective)return alert('Aucun objectif actif.');
  if(!confirm(`Reconstruire le plan « ${objective.title} » à partir de ta condition actuelle ?\n\nLes séances passées sont conservées ; aujourd’hui et la suite seront recalculés.`))return;
  planV2Busy=true;
  const button=document.querySelector('#regeneratePlanV2Button'),status=document.querySelector('#planV2ManagementStatus');
  if(button){button.disabled=true;button.textContent='Analyse et reconstruction…';} if(status)status.textContent='Analyse des données COROS, de l’historique et de l’objectif…';
  try{
    const response=await fetch(`/api/objectives/${encodeURIComponent(objective.id)}/regenerate`,{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    const body=await response.json();if(!response.ok)throw new Error(body.error||'Reconstruction impossible');
    if(status)status.textContent=`Plan reconstruit ✓ · ${body.generation?.mode==='ai+rules'?'Coach IA + règles':'moteur personnalisé'}`;
    if(typeof safeReload==='function')await safeReload(); planV2WeekIndex=0; await renderPlanV2CurrentWeek();
  }catch(error){console.error(error);if(status)status.textContent=error.message||'Erreur';}
  finally{planV2Busy=false;if(button){button.disabled=false;button.textContent='✦ Reconstruire ce plan avec le Coach';}}
}

async function deleteObjectiveByIdV2(id,title) {
  if(!id)return;
  if(!confirm(`Supprimer « ${title||'cet objectif'} » et son plan ?\n\nTes activités COROS et ton historique de ressenti sont conservés.`))return;
  const response=await fetch(`/api/objectives/${encodeURIComponent(id)}`,{method:'DELETE'}),body=await response.json();
  if(!response.ok)throw new Error(body.error||'Suppression impossible');
  document.querySelector('#goalDetail')?.classList.remove('open'); document.body.style.overflow='';
  if(typeof safeReload==='function')await safeReload();
  await renderPlanV2CurrentWeek(); setTimeout(refreshPlanV2Management,50);
}
async function deleteActiveObjectiveV2(){try{const data=await getDashboardSnapshot();if(!data.activeObjective)return;await deleteObjectiveByIdV2(data.activeObjective.id,data.activeObjective.title);}catch(error){console.error(error);alert(error.message||'Suppression impossible');}}

function decorateOtherObjectivesV2(data) {
  const list=document.querySelector('#goalList'); if(!list)return;
  const others=(data.objectives||[]).filter(item=>item.id!==data.activeObjective?.id);
  [...list.children].forEach((row,index)=>{
    const objective=others[index]; if(!objective||row.querySelector('.plan-v2-mini-delete'))return;
    const button=document.createElement('button');button.type='button';button.className='plan-v2-mini-delete';button.textContent='Supprimer';
    button.addEventListener('click',async event=>{event.preventDefault();event.stopPropagation();try{await deleteObjectiveByIdV2(objective.id,objective.title);}catch(error){alert(error.message||'Suppression impossible');}});
    row.appendChild(button);
  });
}

async function refreshPlanV2Management() {
  try{
    ensurePlanV2GoalActions(); const data=await getDashboardSnapshot();
    const target=document.querySelector('#goalDetailTarget'); if(target&&data.activeObjective)target.textContent=`Cible : ${goalTargetText(data.activeObjective)}`;
    const engine=document.querySelector('#planV2EngineInfo')||document.createElement('div');
    if(data.activePlan){engine.id='planV2EngineInfo';engine.className='plan-v2-engine';engine.textContent=data.activePlan.generatedBy==='personalized-plan-v2'?`Plan personnalisé · ${data.activePlan.generationMode==='ai+rules'?'Coach IA + règles':'règles sportives'} · ${data.activePlan.sessions?.length||0} séances`:'Plan hérité · utilise « Reconstruire » pour passer au moteur personnalisé.';const card=document.querySelector('#goalDetail .goal-active-card');if(card&&!engine.isConnected)card.appendChild(engine);}
    decorateOtherObjectivesV2(data);
  }catch(error){console.error('Plan v2 management',error);}
}

function currentPlanWeekIndex(data) {
  const plan=data.activePlan;if(!plan?.startDate)return 0;
  const today=data.meta?.today||new Date().toISOString().slice(0,10);
  return Math.max(0,Math.min((plan.totalWeeks||1)-1,Math.floor((planV2Date(today)-planV2Date(plan.startDate))/(7*86400000))));
}
async function renderPlanV2CurrentWeek() {
  try{
    const data=await getDashboardSnapshot(),plan=data.activePlan;if(!plan)return;
    if(planV2WeekIndex===null)planV2WeekIndex=currentPlanWeekIndex(data);
    const max=Math.max(0,(plan.totalWeeks||1)-1);planV2WeekIndex=Math.max(0,Math.min(max,planV2WeekIndex));
    const start=planV2AddDays(plan.startDate,planV2WeekIndex*7),end=planV2AddDays(start,6);
    const sessions=(plan.sessions||[]).filter(s=>s.date>=start&&s.date<=end).sort((a,b)=>a.date.localeCompare(b.date));
    const week=document.querySelector('#week');if(week){week.innerHTML=sessions.length?sessions.map(session=>`<button class="week-day ${session.date===data.meta?.today?'today':''}" type="button" data-session-id="${planV2Escape(session.id)}"><div class="day-badge"><span>${planV2Escape(session.day||'')}</span><strong>${planV2Date(session.date).getDate()}</strong></div><div class="week-main"><strong>${planV2SportEmoji(session.sport)} ${planV2Escape(session.title)}</strong><span>${planV2Escape(session.sport)} · ${planV2Escape(session.duration)}${session.hrTarget?` · ${planV2Escape(session.hrTarget)}`:''}</span></div><span class="week-chevron">›</span></button>`).join(''):'<article class="card compact-card"><strong>Repos / récupération</strong><p>Aucune séance prévue cette semaine dans ce plan.</p></article>';week.querySelectorAll('[data-session-id]').forEach(button=>button.addEventListener('click',()=>typeof showSessionDetail==='function'&&showSessionDetail(button.dataset.sessionId)));}
    const weekLabel=document.querySelector('#planWeek');if(weekLabel)weekLabel.textContent=`Semaine ${planV2WeekIndex+1} / ${plan.totalWeeks||1}`;
    const dates=document.querySelector('#planWeekDates');if(dates)dates.textContent=`${planV2FormatDate(start)} – ${planV2FormatDate(end)}`;
    const phase=sessions.find(s=>s.phase)?.phase || (planV2WeekIndex===currentPlanWeekIndex(data)?plan.phase:'');if(phase){const el=document.querySelector('#planPhase');if(el)el.textContent=phase;}
    const arrows=document.querySelectorAll('.week-selector .icon-button');if(arrows[0])arrows[0].disabled=planV2WeekIndex<=0;if(arrows[1])arrows[1].disabled=planV2WeekIndex>=max;
  }catch(error){console.error('Plan week v2',error);}
}

function bindPlanV2WeekNavigation() {
  const arrows=document.querySelectorAll('.week-selector .icon-button');
  if(arrows[0]&&!arrows[0].dataset.planV2){arrows[0].dataset.planV2='1';arrows[0].addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();planV2WeekIndex=Math.max(0,(planV2WeekIndex??0)-1);renderPlanV2CurrentWeek();},{capture:true});}
  if(arrows[1]&&!arrows[1].dataset.planV2){arrows[1].dataset.planV2='1';arrows[1].addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();planV2WeekIndex=(planV2WeekIndex??0)+1;renderPlanV2CurrentWeek();},{capture:true});}
  const more=document.querySelector('.plan-more');if(more&&!more.dataset.planV2){more.dataset.planV2='1';more.textContent='Semaine suivante ↓';more.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();planV2WeekIndex=(planV2WeekIndex??0)+1;renderPlanV2CurrentWeek();},{capture:true});}
}

async function polishV2RestDay() {
  try{
    const data=await getDashboardSnapshot();if(data.todaySession)return;
    const plan=data.activePlan,today=data.meta?.today;if(!plan||!today||!plan.endDate||today>plan.endDate)return;
    const values={'#todayTitle':'Repos / récupération','#todaySport':'Aucune séance prévue aujourd’hui','#todaySportIcon':'🧘','#todayDuration':'—','#todayZoneBpm':'—','#todayZoneName':'Repos','#todayRpe':'1/10','#todayDetails':'Cette journée sans séance fait partie du plan. Récupère, marche ou fais un peu de mobilité si tu en as envie.'};
    for(const [selector,value] of Object.entries(values)){const el=document.querySelector(selector);if(el)el.textContent=value;}
    for(const selector of ['#viewSessionButton','#adaptBtn','#doneBtn']){const b=document.querySelector(selector);if(b)b.disabled=true;}
  }catch(error){console.error('Rest day v2',error);}
}

function initPlanV2() {
  ensurePlanV2Styles();ensureObjectiveV2Form();bindObjectiveV2Create();ensurePlanV2GoalActions();bindPlanV2WeekNavigation();
  refreshPlanV2Management();renderPlanV2CurrentWeek();setTimeout(polishV2RestDay,350);
  const list=document.querySelector('#goalList');if(list)new MutationObserver(()=>refreshPlanV2Management()).observe(list,{childList:true});
}

document.addEventListener('click',event=>{
  if(event.target.closest('#newGoalButton,#newObjectiveButton'))setTimeout(()=>{ensureObjectiveV2Form();bindObjectiveV2Create();},20);
  if(event.target.closest('[data-screen="plan"]'))setTimeout(renderPlanV2CurrentWeek,40);
  if(event.target.closest('#manageGoalButton,#manageGoalFromToday'))setTimeout(refreshPlanV2Management,40);
});
window.addEventListener('pageshow',()=>{setTimeout(()=>{renderPlanV2CurrentWeek();refreshPlanV2Management();polishV2RestDay();},120);});
window.addEventListener('focus',()=>setTimeout(polishV2RestDay,150));
setTimeout(initPlanV2,550);
