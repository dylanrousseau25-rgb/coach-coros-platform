const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let appData = null;
let selectedAdaptation = '';
let lastLoadedDay = '';

const sportEmoji = sport => /vélo|gravel/i.test(sport || '')
  ? '🚴'
  : /repos|mobilité/i.test(sport || '')
    ? '🧘'
    : '🏃';

const statusText = value => value >= 80
  ? 'Très bonne récupération'
  : value >= 55
    ? 'Récupération correcte'
    : 'Récupération à surveiller';

function formatDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!value) return 'Sans date';
  return new Intl.DateTimeFormat('fr-FR', options).format(new Date(`${value}T12:00:00`));
}

function formatToday(value) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  }).format(new Date(`${value}T12:00:00`));
}

function localDateIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function metricsAreLive(data) {
  return Boolean(data?.meta?.corosMode && data.meta.corosMode !== 'demo');
}

function exactTodaySession(data) {
  const today = data?.meta?.today;
  if (!today) return null;
  return (data?.activePlan?.sessions || []).find(session => session.date === today)
    || (data?.todaySession?.date === today ? data.todaySession : null);
}

function objectiveProgress(data) {
  const plan = data.activePlan;
  const objective = data.activeObjective;
  if (!plan?.startDate || !objective?.date) return 0;
  const start = new Date(`${plan.startDate}T00:00:00`);
  const end = new Date(`${objective.date}T00:00:00`);
  const now = new Date(`${data.meta.today}T00:00:00`);
  return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
}

function sessionObjective(session) {
  if (!session) return '';
  if (/récup/i.test(session.title)) return 'Favoriser la récupération et absorber la charge récente sans ajouter de fatigue.';
  if (/endurance/i.test(session.title)) return 'Développer ton endurance aérobie sans ajouter de fatigue excessive.';
  if (/longue/i.test(session.title)) return 'Construire ton endurance spécifique avec une intensité maîtrisée.';
  if (/blocs|allure/i.test(session.title)) return 'Travailler l’allure de ton objectif tout en gardant une intensité contrôlée.';
  return session.details || 'Construire ta progression en restant cohérent avec ton objectif actif.';
}

function setScreen(name) {
  $$('.screen').forEach(element => element.classList.toggle('active', element.dataset.screenPanel === name));
  $$('.nav-item').forEach(element => element.classList.toggle('active', element.dataset.screen === name));
  $('.topbar').style.display = name === 'today' ? '' : 'none';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openDetail(id) {
  const element = $(`#${id}`);
  if (!element) return;
  element.classList.add('open');
  element.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeDetail(element) {
  if (!element) return;
  element.classList.remove('open');
  element.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function setTodaySessionEmpty() {
  $('#todayTitle').textContent = 'Aucune séance planifiée';
  $('#todaySport').textContent = 'Le plan doit être prolongé';
  $('#todaySportIcon').textContent = '🗓️';
  $('#todayDuration').textContent = '—';
  $('#todayZoneBpm').textContent = '—';
  $('#todayZoneName').textContent = '—';
  $('#todayRpe').textContent = '—';
  $('#todayDetails').textContent = 'Aucune séance n’est datée pour aujourd’hui. Le coach ne recycle plus une ancienne séance comme si elle était prévue aujourd’hui.';
  $('#viewSessionButton').disabled = true;
  $('#adaptBtn').disabled = true;
  $('#doneBtn').disabled = true;
}

function setTodaySession(session) {
  $('#todayTitle').textContent = session.title;
  $('#todaySport').textContent = session.sport;
  $('#todaySportIcon').textContent = sportEmoji(session.sport);
  $('#todayDuration').textContent = session.duration;
  $('#todayZoneBpm').textContent = session.hrTarget || '—';
  $('#todayZoneName').textContent = session.zoneLabel || `Z${session.zone || ''}`;
  $('#todayRpe').textContent = session.rpeTarget || '—';
  $('#todayDetails').textContent = session.details || sessionObjective(session);
  $('#viewSessionButton').disabled = false;
  $('#adaptBtn').disabled = false;
  $('#doneBtn').disabled = false;
}

function renderToday(data) {
  $('#todayDate').textContent = formatToday(data.meta.today);

  if (metricsAreLive(data)) {
    const recovery = Number(data.metrics?.recovery);
    $('#recovery').textContent = Number.isFinite(recovery) ? `${recovery}%` : '—';
    $('#recoveryLabel').textContent = Number.isFinite(recovery) ? statusText(recovery) : 'Données COROS indisponibles';
    $('#sleepDuration').textContent = data.metrics?.sleepDuration || '—';
    $('#shortLoad').textContent = data.metrics?.shortTermLoad ?? '—';
    $('#readinessInsight').textContent = recovery >= 80
      ? 'Tu peux t’entraîner normalement aujourd’hui. Le coach garde toutefois la charge récente en tête.'
      : recovery >= 55
        ? 'Tu peux maintenir la séance prévue, en restant attentif aux sensations.'
        : 'Ton état invite à réduire l’intensité aujourd’hui.';
  } else {
    $('#recovery').textContent = '—';
    $('#sleepDuration').textContent = '—';
    $('#shortLoad').textContent = '—';
    $('#recoveryLabel').textContent = 'COROS non synchronisé';
    $('#readinessInsight').textContent = 'Ces métriques ne sont pas des données du jour. Elles resteront masquées tant qu’une vraie synchronisation COROS n’est pas active.';
  }

  const session = exactTodaySession(data);
  if (session) setTodaySession(session);
  else setTodaySessionEmpty();

  const objective = data.activeObjective;
  const plan = data.activePlan;
  const progress = objectiveProgress(data);
  if (objective) {
    $('#activeObjectiveTitle').textContent = objective.title;
    $('#activeObjectiveMeta').textContent = `${formatDate(objective.date)} · ${data.meta.daysToObjective ?? '—'} jours restants`;
    $('#activePlanPhase').textContent = plan?.phase || 'Plan à construire';
    $('#objectiveProgressLabel').textContent = `${progress}%`;
    $('#objectiveProgressBar').style.width = `${progress}%`;
  }

  const sessions = plan?.sessions || [];
  const done = sessions.filter(session => session.status === 'completed').length;
  $('#weekProgressText').textContent = `${done} / ${sessions.length} séances terminées`;
  $('#weekDots').innerHTML = sessions.slice(0, 7).map((session, index) => `<span class="${index < done ? 'done' : ''}"></span>`).join('');

  const futureSessions = sessions
    .filter(session => session.date && session.date >= data.meta.today && session.status !== 'completed')
    .sort((a, b) => a.date.localeCompare(b.date));
  const nextKey = futureSessions.find(session => /blocs|seuil|longue|allure|tempo/i.test(session.title)) || futureSessions[0];
  $('#nextKeySession').textContent = nextKey ? `${nextKey.day || ''} · ${nextKey.title}` : 'Plan à prolonger';
}

function renderPlan(data) {
  const objective = data.activeObjective;
  const plan = data.activePlan;
  const progress = objectiveProgress(data);

  $('#planObjectiveTitle').textContent = objective?.title || 'Aucun objectif actif';
  $('#planObjectiveMeta').textContent = objective ? `${formatDate(objective.date)} · ${data.meta.daysToObjective ?? '—'} jours restants` : '—';
  $('#planPhase').textContent = plan?.phase || 'Plan à construire';
  $('#planProgressLabel').textContent = `${progress}%`;
  $('#planProgressBar').style.width = `${progress}%`;
  $('#planWeek').textContent = plan?.totalWeeks ? `Semaine ${plan.currentWeek}` : 'Semaine';

  const dates = (plan?.sessions || []).map(session => session.date).filter(Boolean).sort();
  $('#planWeekDates').textContent = dates.length
    ? `${formatDate(dates[0], { day: 'numeric', month: 'short' })} – ${formatDate(dates.at(-1), { day: 'numeric', month: 'short' })}`
    : '—';

  $('#week').innerHTML = (plan?.sessions || []).map(session => `
    <button class="week-day ${session.date === data.meta.today ? 'today' : ''}" type="button" data-session-id="${session.id}">
      <div class="day-badge"><span>${session.day || ''}</span><strong>${session.date ? new Date(`${session.date}T12:00:00`).getDate() : ''}</strong></div>
      <div class="week-main"><strong>${sportEmoji(session.sport)} ${session.title}</strong><span>${session.sport} · ${session.duration}${session.hrTarget ? ` · ${session.hrTarget}` : ''}</span></div>
      <span class="week-chevron">›</span>
    </button>
  `).join('');
  $$('[data-session-id]').forEach(button => button.addEventListener('click', () => showSessionDetail(button.dataset.sessionId)));
}

function renderProgress(data) {
  if (metricsAreLive(data)) {
    $('#formStateLabel').textContent = data.metrics.loadRatio > 1.3 ? 'Charge élevée' : data.metrics.loadRatio < 0.75 ? 'Reprise progressive' : 'En progression';
    $('#formStateInsight').textContent = data.metrics.loadRatio < 0.75
      ? 'Ta charge est plutôt légère : la priorité est de reconstruire progressivement sans brûler les étapes.'
      : data.metrics.loadRatio > 1.3
        ? 'Ta charge est élevée. Le prochain progrès viendra surtout de la récupération.'
        : 'Ta charge est équilibrée. Continue à progresser sans accélérer brutalement le volume.';
    $('#progressLoad').textContent = data.metrics.shortTermLoad ?? '—';
  } else {
    $('#formStateLabel').textContent = 'COROS non synchronisé';
    $('#formStateInsight').textContent = 'La forme actuelle et la charge ne sont pas recalculées tant que les données COROS réelles ne sont pas synchronisées.';
    $('#progressLoad').textContent = '—';
  }

  $('#progressVo2').textContent = data.metrics?.vo2max ?? '—';
  $('#progressThresholdHr').textContent = data.heartRateZones?.thresholdHr ?? '—';
  $('#progressThresholdPace').textContent = data.metrics?.thresholdPace ?? '—';

  const activity = data.latestActivity;
  if (activity) {
    $('#latestSport').textContent = activity.sport;
    $('#latestDate').textContent = formatDate(activity.date, { weekday: 'long', day: 'numeric', month: 'long' });
    $('#activityKpis').innerHTML = [
      [activity.distance, 'Distance'],
      [activity.duration, 'Durée'],
      [activity.pace, 'Allure'],
      [`${activity.avgHr} bpm`, 'FC moy.']
    ].map(([value, label]) => `<div class="activity-kpi"><strong>${value}</strong><span>${label}</span></div>`).join('');
    $('#latestFocus').textContent = activity.trainingFocus || 'Activité';
    $('#coachNote').textContent = activity.coachNote || 'Analyse disponible avec le coach.';
  }

  const zones = data.heartRateZones?.zones || [];
  $('#zoneModel').textContent = `${data.heartRateZones?.source || 'COROS'} · ${data.heartRateZones?.model || 'Zones'} · FC seuil ${data.heartRateZones?.thresholdHr || '—'} bpm`;
  $('#heartRateZones').innerHTML = zones.map(zone => `<div class="zone-row"><b>Z${zone.zone}</b><span>${zone.name}</span><strong>${zone.range}</strong></div>`).join('');
}

function renderCoach(data) {
  $('#coachGoal').textContent = data.activeObjective?.title || 'Aucun objectif';
  $('#coachPhase').textContent = data.activePlan?.phase || 'Entre deux plans';
  $('#coachRecovery').textContent = metricsAreLive(data)
    ? `${data.metrics.recovery}% · ${statusText(data.metrics.recovery)}`
    : 'Non synchronisé';
  $('#coachLatest').textContent = data.latestActivity
    ? `${formatDate(data.latestActivity.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${data.latestActivity.sport}`
    : 'Aucune activité';
}

function renderProfile(data) {
  $('#profileApproach').textContent = data.athlete.approach || '—';
  $('#profileAvailability').textContent = data.athlete.availability || '—';
  $('#profileSports').textContent = (data.athlete.sports || []).join(' · ');
  $('#profileInjury').textContent = data.athlete.injuryNotes || 'Aucune vigilance particulière';
  $('#profileThresholdHr').textContent = `${data.heartRateZones?.thresholdHr || '—'} bpm`;
}

function renderGoals(data) {
  const objective = data.activeObjective;
  const plan = data.activePlan;
  const progress = objectiveProgress(data);
  $('#goalDetailTitle').textContent = objective?.title || 'Aucun objectif';
  $('#goalDetailSport').textContent = objective?.sport || '—';
  $('#goalDetailDate').textContent = objective ? formatDate(objective.date) : '—';
  $('#goalDetailTarget').textContent = objective?.target ? `Cible : ${objective.target}` : 'Cible à préciser';
  $('#goalDetailPhase').textContent = plan?.phase || 'Plan à construire';
  $('#goalDetailProgress').textContent = `${progress}%`;
  $('#goalDetailProgressBar').style.width = `${progress}%`;

  const others = (data.objectives || []).filter(item => item.id !== objective?.id);
  $('#goalList').innerHTML = others.length
    ? others.map(item => `
      <div class="goal-list-item">
        <div><h3>${item.title}</h3><p>${item.status === 'completed' ? 'Terminé' : `${item.sport} · ${formatDate(item.date)}`}</p></div>
        ${item.status === 'completed' ? '<span>✓</span>' : `<button class="button ghost" type="button" data-activate-objective="${item.id}">Activer</button>`}
      </div>
    `).join('')
    : '<div class="goal-list-item"><div><h3>Aucun autre objectif</h3><p>Ajoute ton prochain défi quand tu veux.</p></div></div>';
  $$('[data-activate-objective]').forEach(button => button.addEventListener('click', () => activateObjective(button.dataset.activateObjective)));
}

function render(data) {
  data.todaySession = exactTodaySession(data);
  appData = data;
  lastLoadedDay = data.meta?.today || localDateIso();
  renderToday(data);
  renderPlan(data);
  renderProgress(data);
  renderCoach(data);
  renderProfile(data);
  renderGoals(data);
}

async function load() {
  const response = await fetch('/api/dashboard', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Dashboard ${response.status}`);
  render(await response.json());
}

async function safeReload() {
  try {
    await load();
  } catch (error) {
    console.error(error);
    $('#readinessInsight').textContent = 'Impossible de charger les données.';
  }
}

function showSessionDetail(id) {
  const session = (appData?.activePlan?.sessions || []).find(item => item.id === id) || appData?.todaySession;
  if (!session) return;
  $('#detailSport').textContent = session.sport;
  $('#detailTitle').textContent = session.title;
  $('#detailDate').textContent = `${formatDate(session.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${session.duration}`;
  $('#detailObjective').textContent = sessionObjective(session);
  $('#detailHr').textContent = session.hrTarget || '—';
  $('#detailZone').textContent = session.zoneLabel || `Z${session.zone || ''}`;
  $('#detailRpe').textContent = session.rpeTarget || '—';
  $('#detailPace').textContent = session.paceTarget || 'Libre';
  $('#detailCoachTip').textContent = session.details || sessionObjective(session);
  const timeline = /blocs|allure/i.test(session.title)
    ? [['00:00', 'Échauffement', '15 min facile'], ['15:00', 'Bloc spécifique', '4 × 5 min à l’allure cible'], ['47:00', 'Retour au calme', '10 min facile']]
    : [['00:00', 'Échauffement', '10 min facile'], ['10:00', session.title, '25–35 min en intensité cible'], ['35:00', 'Retour au calme', '5–10 min']];
  $('#sessionTimeline').innerHTML = timeline.map(([time, title, detail]) => `<div class="timeline-item"><div class="timeline-time">${time}</div><div class="timeline-marker"></div><div class="timeline-copy"><strong>${title}</strong><span>${detail}</span></div></div>`).join('');
  openDetail('sessionDetail');
}

function showActivityDetail() {
  const activity = appData?.latestActivity;
  if (!activity) return;
  $('#activityDetailSport').textContent = activity.sport;
  $('#activityDetailDate').textContent = formatDate(activity.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#activityDetailKpis').innerHTML = [[activity.distance, 'Distance'], [activity.duration, 'Durée'], [activity.pace, 'Allure']]
    .map(([value, label]) => `<div><strong>${value}</strong><span>${label}</span></div>`).join('');
  $('#activityAvgHr').textContent = `${activity.avgHr} bpm`;
  $('#activityMaxHr').textContent = `${activity.maxHr} bpm`;
  $('#activityCoachAnalysis').textContent = activity.coachNote || 'Le coach peut analyser cette séance à partir de tes zones.';
  openDetail('activityDetail');
}

async function activateObjective(id) {
  const response = await fetch(`/api/objectives/${encodeURIComponent(id)}/activate`, { method: 'POST' });
  const body = await response.json();
  if (!response.ok) return alert(body.error || 'Erreur');
  await safeReload();
}

async function createObjective() {
  const form = $('#objectiveForm');
  if (!form.reportValidity()) return;
  const payload = Object.fromEntries(new FormData(form).entries());
  const response = await fetch('/api/objectives', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const body = await response.json();
  if (!response.ok) {
    $('#objectiveStatus').textContent = body.error || 'Erreur';
    return;
  }
  $('#objectiveDialog').close();
  form.reset();
  await safeReload();
}

function esc(value) {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function sendCoachMessage(message) {
  const text = message.trim();
  if (!text) return;
  $('#chatThread').insertAdjacentHTML('beforeend', `<div class="bubble user-bubble"><div>${esc(text)}</div></div>`);
  const loading = document.createElement('div');
  loading.className = 'bubble coach-bubble';
  loading.innerHTML = '<span class="bubble-avatar">✦</span><div>Analyse…</div>';
  $('#chatThread').appendChild(loading);
  $('#coachInput').value = '';
  try {
    const response = await fetch('/api/coach', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const body = await response.json();
    loading.querySelector('div').textContent = body.reply || body.error || 'Erreur';
  } catch (error) {
    console.error(error);
    loading.querySelector('div').textContent = 'Impossible de joindre le coach.';
  }
}

$$('.nav-item').forEach(item => item.addEventListener('click', () => setScreen(item.dataset.screen)));
$$('[data-close-detail]').forEach(button => button.addEventListener('click', () => closeDetail(button.closest('.detail-view'))));
$$('[data-open-progress]').forEach(button => button.addEventListener('click', () => setScreen('progress')));

$('#viewSessionButton').addEventListener('click', () => showSessionDetail(appData?.todaySession?.id));
$('#doneBtn').addEventListener('click', () => setScreen('progress'));
$('#detailDoneButton').addEventListener('click', () => {
  closeDetail($('#sessionDetail'));
  setScreen('progress');
});

function openAdapt() {
  if (!appData?.todaySession) return;
  selectedAdaptation = '';
  $$('[data-adapt-choice]').forEach(item => item.classList.remove('selected'));
  $('#adaptNote').value = '';
  $('#adaptSheet').showModal();
}

$('#adaptBtn').addEventListener('click', openAdapt);
$('#detailAdaptButton').addEventListener('click', openAdapt);
$$('[data-adapt-choice]').forEach(button => button.addEventListener('click', () => {
  selectedAdaptation = button.dataset.adaptChoice;
  $$('[data-adapt-choice]').forEach(item => item.classList.toggle('selected', item === button));
}));
$('#askAdaptationButton').addEventListener('click', async () => {
  const note = $('#adaptNote').value.trim();
  const message = `Adapte ma séance d'aujourd'hui. ${selectedAdaptation}${note ? `. Détail : ${note}` : ''}`;
  $('#adaptSheet').close();
  setScreen('coach');
  await sendCoachMessage(message);
});

$('#manageGoalFromToday').addEventListener('click', () => openDetail('goalDetail'));
$('#manageGoalButton').addEventListener('click', () => openDetail('goalDetail'));
$('#goalViewPlanButton').addEventListener('click', () => {
  closeDetail($('#goalDetail'));
  setScreen('plan');
});
$('#newGoalButton').addEventListener('click', () => $('#objectiveDialog').showModal());
$('#newObjectiveButton').addEventListener('click', () => $('#objectiveDialog').showModal());
$('#viewActivityButton').addEventListener('click', showActivityDetail);
$('#activityFeedbackButton').addEventListener('click', () => {
  closeDetail($('#activityDetail'));
  setScreen('progress');
  $('#zonesCard').classList.remove('hidden');
});
$('#toggleZonesButton').addEventListener('click', () => $('#zonesCard').classList.toggle('hidden'));
$('#profileButton').addEventListener('click', () => $('#profileDialog').showModal());
$('#closeProfileButton').addEventListener('click', () => $('#profileDialog').close());
$('#closeObjectiveButton').addEventListener('click', () => $('#objectiveDialog').close());
$('#createObjectiveButton').addEventListener('click', createObjective);
$$('[data-prompt]').forEach(button => button.addEventListener('click', async () => {
  setScreen('coach');
  await sendCoachMessage(button.dataset.prompt);
}));
$('#coachForm').addEventListener('submit', async event => {
  event.preventDefault();
  await sendCoachMessage($('#coachInput').value);
});

window.addEventListener('pageshow', () => safeReload());
window.addEventListener('focus', () => safeReload());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') safeReload();
});
setInterval(() => {
  if (localDateIso() !== lastLoadedDay) safeReload();
}, 60_000);

safeReload();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
