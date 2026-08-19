const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let appData = null;

const fallbackZones = [
  { zone: 1, name: "Récupération", range: "< 134 bpm", percent: "<80%", max: 133 },
  { zone: 2, name: "Aérobie (endur.)", range: "134–151 bpm", percent: "80–90%", min: 134, max: 151 },
  { zone: 3, name: "Aérobie (puiss.)", range: "152–160 bpm", percent: "91–95%", min: 152, max: 160 },
  { zone: 4, name: "Seuil", range: "161–171 bpm", percent: "96–102%", min: 161, max: 171 },
  { zone: 5, name: "Anaérobie (endur.)", range: "172–178 bpm", percent: "103–106%", min: 172, max: 178 },
  { zone: 6, name: "Anaérobie (puiss.)", range: "> 178 bpm", percent: ">106%", min: 179 }
];

const screenMeta = {
  today: ["Aujourd’hui", "Ton entraînement, pas un plan figé."],
  plan: ["Plan", "Le plan actif s’adapte à tes données."],
  goals: ["Objectifs", "Change de défi sans changer d’app."],
  progress: ["Progrès", "Ton historique devient ton avantage."],
  coach: ["Coach", "Un seul coach à travers tous tes objectifs."]
};

function formatDate(value) {
  if (!value) return "Sans date";
  const d = new Date(`${value}T12:00:00`);
  return new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

function daysTo(value) {
  if (!value) return null;
  const target = new Date(`${value}T00:00:00`);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return Math.max(0, Math.ceil((target - now) / 86400000));
}

function zoneForHr(hr, zones) {
  if (!Number.isFinite(hr)) return null;
  const items = zones?.length ? zones : fallbackZones;
  for (const z of items) {
    const minOk = z.min == null || hr >= z.min;
    const maxOk = z.max == null || hr <= z.max;
    if (minOk && maxOk) return z.zone;
  }
  return null;
}

function zoneLabel(zone) {
  const names = {
    1: "Z1 · Récupération",
    2: "Z2 · Endurance",
    3: "Z3 · Aérobie",
    4: "Z4 · Seuil",
    5: "Z5 · Anaérobie",
    6: "Z6 · Haute intensité"
  };
  return names[zone] || "Zone inconnue";
}

function setScreen(name) {
  $$('[data-screen-panel]').forEach(el => el.classList.toggle('active', el.dataset.screenPanel === name));
  $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.screen === name));
  const [title, subtitle] = screenMeta[name] || screenMeta.today;
  $('#headerTitle').textContent = title;
  $('#headerSubtitle').textContent = subtitle;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderToday(data) {
  $('#recovery').textContent = `${data.metrics.recovery}%`;
  $('#recoveryLabel').textContent = data.metrics.recovery >= 80 ? 'Très bonne' : data.metrics.recovery >= 50 ? 'Correcte' : 'À surveiller';
  $('#vo2max').textContent = data.metrics.vo2max ?? '—';
  $('#shortLoad').textContent = data.metrics.shortTermLoad ?? '—';
  $('#loadLabel').textContent = data.metrics.loadRatio < .75 ? 'Reprise' : data.metrics.loadRatio > 1.3 ? 'Élevée' : 'Stable';

  const objective = data.activeObjective;
  const plan = data.activePlan;
  if (objective) {
    $('#activeObjectiveTitle').textContent = objective.title;
    $('#activeObjectiveMeta').textContent = `${objective.sport} · ${formatDate(objective.date)}`;
    $('#activeObjectiveTarget').textContent = objective.target ? `Cible · ${objective.target}` : 'Cible à préciser';
    $('#activePlanPhase').textContent = plan?.phase ? `Phase · ${plan.phase}` : 'Plan à construire';
    $('#daysToObjective').textContent = data.meta.daysToObjective ?? '∞';
  } else {
    $('#activeObjectiveTitle').textContent = 'Aucun objectif actif';
    $('#activeObjectiveMeta').textContent = 'Crée ton prochain défi dans Objectifs.';
    $('#activeObjectiveTarget').textContent = 'Objectif libre';
    $('#activePlanPhase').textContent = 'Coach disponible';
    $('#daysToObjective').textContent = '—';
  }

  const session = data.todaySession;
  if (session) {
    $('#todayTitle').textContent = session.title;
    $('#todaySport').textContent = session.sport;
    $('#todayDuration').textContent = session.duration;
    $('#todayZoneName').textContent = session.zoneLabel || `Z${session.zone}`;
    $('#todayZoneBpm').textContent = session.hrTarget || '—';
    $('#todayRpe').textContent = session.rpeTarget || '—';
    $('#todayPace').textContent = session.paceTarget || '—';
    $('#todayDetails').textContent = session.details || plan?.principle || 'Séance prévue par le plan actif.';
    $('#doneBtn').disabled = false;
    $('#adaptBtn').disabled = false;
  } else {
    $('#todayTitle').textContent = 'Aucune séance planifiée';
    $('#todaySport').textContent = objective ? 'Le coach peut construire ou adapter la journée.' : 'Commence par choisir un objectif.';
    $('#todayDuration').textContent = 'Libre';
    $('#todayZoneName').textContent = '—';
    $('#todayZoneBpm').textContent = '—';
    $('#todayRpe').textContent = '—';
    $('#todayPace').textContent = '—';
    $('#todayDetails').textContent = objective ? 'Le plan actif ne contient pas encore de séance pour aujourd’hui.' : 'Ton historique et tes zones COROS restent disponibles même sans objectif actif.';
    $('#doneBtn').disabled = true;
  }

  $('#coachGlanceText').textContent = objective
    ? `Le coach relie la séance du jour à « ${objective.title} », mais peut la modifier selon ta récupération et ton ressenti.`
    : 'Tu peux continuer à utiliser le coach et tes données même entre deux plans.';
}

function renderPlan(data) {
  const plan = data.activePlan;
  if (!plan) {
    $('#planName').textContent = 'Aucun plan actif';
    $('#planMeta').textContent = 'Active un objectif pour lui associer un plan.';
    $('#planWeek').textContent = '—';
    $('#planPrinciple').textContent = 'Le plan sera construit à partir de ton profil permanent.';
    $('#week').innerHTML = '<div class="empty-state"><strong>Pas de plan en cours</strong>Va dans Objectifs pour créer ou activer ton prochain défi.</div>';
    return;
  }

  $('#planName').textContent = plan.name;
  $('#planMeta').textContent = `${plan.phase || 'Phase à définir'} · ${formatDate(plan.startDate)} → ${formatDate(plan.endDate)}`;
  $('#planWeek').textContent = plan.totalWeeks ? `S${plan.currentWeek}/${plan.totalWeeks}` : 'Brouillon';
  $('#planPrinciple').textContent = plan.principle || 'Plan adaptatif.';

  const sessions = plan.sessions || [];
  $('#week').innerHTML = sessions.length ? sessions.map(s => `
    <article class="week-day${s.status === 'today' ? ' today' : ''}${s.status === 'completed' ? ' completed' : ''}">
      <div class="day-badge">${s.day || new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(new Date(`${s.date}T12:00:00`)).slice(0,3)}</div>
      <div class="week-main">
        <strong>${s.title}</strong>
        <span>${s.sport} · ${s.duration} · ${s.hrTarget || 'sans cible FC'}</span>
      </div>
      <span class="zone-chip zone-${s.zone || 1}">${s.zoneLabel || `Z${s.zone || 1}`}</span>
    </article>`).join('') : '<div class="empty-state"><strong>Plan à construire</strong>Cet objectif existe, mais ses séances n’ont pas encore été générées.</div>';
}

function statusLabel(status) {
  return ({ active: 'Actif', planned: 'Prévu', completed: 'Terminé' })[status] || status;
}

function renderGoals(data) {
  const active = data.activeObjective;
  const plan = data.activePlan;
  if (active) {
    $('#featureGoalTitle').textContent = active.title;
    $('#featureGoalMeta').textContent = `${active.sport} · ${formatDate(active.date)}`;
    $('#featureGoalTarget').textContent = active.target || 'À préciser';
    $('#featureGoalPhase').textContent = plan?.phase || 'À construire';
    $('#featureGoalDays').textContent = data.meta.daysToObjective != null ? `${data.meta.daysToObjective} j` : 'Libre';
  } else {
    $('#featureGoalTitle').textContent = 'Entre deux objectifs';
    $('#featureGoalMeta').textContent = 'Ton profil, tes activités et tes feedbacks restent conservés.';
    $('#featureGoalTarget').textContent = '—';
    $('#featureGoalPhase').textContent = 'Maintenance';
    $('#featureGoalDays').textContent = '—';
  }

  const goals = data.objectives || [];
  $('#goalList').innerHTML = goals.length ? goals.map(o => {
    const linkedPlan = data.plans.find(p => p.id === o.planId);
    const actions = o.status === 'active'
      ? `<button class="goal-action" type="button" data-complete-objective="${o.id}">Terminer</button>`
      : o.status === 'completed'
        ? ''
        : `<button class="goal-action primary" type="button" data-activate-objective="${o.id}">Activer</button>`;
    return `<article class="goal-item ${o.status === 'active' ? 'active' : ''}">
      <div class="goal-item-head">
        <div><h3>${o.title}</h3><p>${o.sport} · ${formatDate(o.date)}${o.target ? ` · ${o.target}` : ''}</p></div>
        <span class="goal-status ${o.status}">${statusLabel(o.status)}</span>
      </div>
      <p>Plan : ${linkedPlan?.name || 'non associé'} · ${linkedPlan?.phase || 'à construire'}</p>
      <div class="goal-item-actions">${actions}</div>
    </article>`;
  }).join('') : '<div class="empty-state"><strong>Aucun objectif</strong>Crée ton premier objectif pour commencer.</div>';

  $$('[data-activate-objective]').forEach(btn => btn.addEventListener('click', () => activateObjective(btn.dataset.activateObjective)));
  $$('[data-complete-objective]').forEach(btn => btn.addEventListener('click', () => completeObjective(btn.dataset.completeObjective)));
}

function renderProgress(data) {
  const zones = data.heartRateZones?.zones || fallbackZones;
  $('#progressVo2').textContent = data.metrics.vo2max ?? '—';
  $('#progressThresholdPace').textContent = data.metrics.thresholdPace ?? '—';
  $('#progressThresholdHr').textContent = data.heartRateZones?.thresholdHr ?? '—';
  $('#feedbackCount').textContent = (data.feedback || []).length;
  $('#zoneModel').textContent = `${data.heartRateZones?.source || 'COROS'} · ${data.heartRateZones?.model || 'Zones FC'} · FC seuil ${data.heartRateZones?.thresholdHr || '—'} bpm`;

  $('#heartRateZones').innerHTML = zones.map(z => `<div class="zone-row zone-${z.zone}"><span class="zone-dot"></span><div class="zone-row-name"><strong>Z${z.zone} · ${z.name}</strong><small>${z.percent || ''}</small></div><strong>${z.range}</strong></div>`).join('');

  const latest = data.latestActivity;
  if (!latest) {
    $('#latestSport').textContent = 'Aucune activité';
    $('#latestDate').textContent = 'Synchronise une activité pour commencer.';
    $('#latestFocus').textContent = '—';
    $('#activityKpis').innerHTML = '';
    $('#avgHrValue').textContent = '—';
    $('#maxHrValue').textContent = '—';
    $('#avgHrZone').textContent = '—';
    $('#maxHrZone').textContent = '—';
    $('#coachNote').textContent = 'Aucune analyse disponible.';
    return;
  }

  $('#latestSport').textContent = latest.sport;
  $('#latestDate').textContent = `${formatDate(latest.date)} · ${latest.distance} · ${latest.duration}`;
  $('#latestFocus').textContent = latest.trainingFocus || 'Activité';
  const kpis = [['Allure', latest.pace], ['FC moy.', `${latest.avgHr} bpm`], ['FC max.', `${latest.maxHr} bpm`], ['Charge', latest.trainingLoad ?? '—']];
  $('#activityKpis').innerHTML = kpis.map(([k, v]) => `<article class="activity-metric"><span>${k}</span><strong>${v}</strong></article>`).join('');
  const avgZone = zoneForHr(latest.avgHr, zones);
  const maxZone = zoneForHr(latest.maxHr, zones);
  $('#avgHrValue').textContent = `${latest.avgHr} bpm`;
  $('#avgHrZone').textContent = zoneLabel(avgZone);
  $('#maxHrValue').textContent = `${latest.maxHr} bpm`;
  $('#maxHrZone').textContent = zoneLabel(maxZone);
  $('#coachNote').textContent = latest.coachNote || 'Activité enregistrée.';
}

function renderCoach(data) {
  $('#coachGoal').textContent = data.activeObjective?.title || 'Aucun objectif actif';
  $('#coachPhase').textContent = data.activePlan?.phase || 'Entre deux plans';
  $('#coachApproach').textContent = data.athlete.approach || '—';
}

function renderProfile(data) {
  $('#profileApproach').textContent = data.athlete.approach || '—';
  $('#profileAvailability').textContent = data.athlete.availability || '—';
  $('#profileSports').textContent = (data.athlete.sports || []).join(' · ');
  $('#profileInjury').textContent = data.athlete.injuryNotes || 'Aucune note';
  $('#profileThresholdHr').textContent = `${data.heartRateZones?.thresholdHr || '—'} bpm · ${data.heartRateZones?.model || ''}`;
}

function render(data) {
  appData = data;
  renderToday(data);
  renderPlan(data);
  renderGoals(data);
  renderProgress(data);
  renderCoach(data);
  renderProfile(data);
}

async function load() {
  const res = await fetch('/api/dashboard');
  if (!res.ok) throw new Error(`Dashboard ${res.status}`);
  render(await res.json());
}

async function activateObjective(id) {
  const res = await fetch(`/api/objectives/${encodeURIComponent(id)}/activate`, { method: 'POST' });
  const body = await res.json();
  if (!res.ok) return alert(body.error || 'Impossible d’activer cet objectif.');
  await load();
  setScreen('today');
}

async function completeObjective(id) {
  if (!confirm('Marquer cet objectif comme terminé ? Ton historique sera conservé.')) return;
  const res = await fetch(`/api/objectives/${encodeURIComponent(id)}/complete`, { method: 'POST' });
  const body = await res.json();
  if (!res.ok) return alert(body.error || 'Impossible de terminer cet objectif.');
  await load();
  setScreen('goals');
}

for (const item of $$('.nav-item')) item.addEventListener('click', () => setScreen(item.dataset.screen));

for (const id of ['rpe', 'legs', 'cardio']) {
  const input = $(`#${id}`);
  const out = $(`#${id}Value`);
  input.addEventListener('input', () => { out.textContent = input.value; });
}

$('#doneBtn').addEventListener('click', () => {
  setScreen('progress');
  setTimeout(() => $('#feedbackCard').scrollIntoView({ behavior: 'smooth', block: 'start' }), 180);
});

$('#adaptBtn').addEventListener('click', () => {
  setScreen('coach');
  $('#coachInput').value = "Adapte la séance d'aujourd'hui selon ma récupération, mon objectif actif, mes zones COROS et mon contexte.";
  setTimeout(() => $('#coachInput').focus(), 180);
});

$('#askCoachToday').addEventListener('click', () => {
  setScreen('coach');
  $('#coachInput').value = "Explique-moi la séance d'aujourd'hui et dis-moi ce que tu veux surveiller pendant la séance.";
  setTimeout(() => $('#coachInput').focus(), 180);
});

$('#feedbackForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const f = new FormData(event.currentTarget);
  const payload = Object.fromEntries(f.entries());
  payload.rpe = Number(payload.rpe);
  payload.legs = Number(payload.legs);
  payload.cardio = Number(payload.cardio);
  $('#feedbackStatus').textContent = 'Enregistrement…';
  try {
    const res = await fetch('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json();
    $('#feedbackStatus').textContent = res.ok ? 'Feedback enregistré dans ton historique sportif.' : (body.error || 'Erreur');
    if (res.ok) await load();
  } catch (error) {
    $('#feedbackStatus').textContent = `Erreur : ${error.message}`;
  }
});

for (const btn of $$('[data-prompt]')) btn.addEventListener('click', () => {
  $('#coachInput').value = btn.dataset.prompt;
  $('#coachInput').focus();
});

$('#coachForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = $('#coachInput').value.trim();
  if (!message) return;
  $('#coachReply').textContent = 'Analyse…';
  try {
    const res = await fetch('/api/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message }) });
    const body = await res.json();
    $('#coachReply').textContent = body.reply || body.error || 'Erreur';
  } catch (error) {
    $('#coachReply').textContent = `Erreur : ${error.message}`;
  }
});

const objectiveDialog = $('#newObjectiveDialog');
$('#newObjectiveButton').addEventListener('click', () => objectiveDialog.showModal());
$('#createObjectiveButton').addEventListener('click', async () => {
  const form = $('#objectiveForm');
  if (!form.reportValidity()) return;
  const payload = Object.fromEntries(new FormData(form).entries());
  $('#objectiveStatus').textContent = 'Création…';
  try {
    const res = await fetch('/api/objectives', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    const body = await res.json();
    if (!res.ok) {
      $('#objectiveStatus').textContent = body.error || 'Erreur';
      return;
    }
    $('#objectiveStatus').textContent = 'Objectif créé. Il reste prévu tant que tu ne l’actives pas.';
    form.reset();
    await load();
    setTimeout(() => objectiveDialog.close(), 450);
  } catch (error) {
    $('#objectiveStatus').textContent = `Erreur : ${error.message}`;
  }
});

const profileDialog = $('#profileDialog');
$('#profileButton').addEventListener('click', () => profileDialog.showModal());
$('#closeProfileButton').addEventListener('click', () => profileDialog.close());

load().catch(error => {
  console.error(error);
  document.body.insertAdjacentHTML('afterbegin', `<p style="padding:20px;color:white">Erreur de chargement : ${error.message}</p>`);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
