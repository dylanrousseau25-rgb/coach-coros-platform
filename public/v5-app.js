const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

let appData = null;
let currentUser = null;
let selectedAdaptation = '';
let coachThreadId = null;
let lastLoadedDay = '';

const sportEmoji = sport => /vélo|gravel/i.test(sport || '') ? '🚴' : /repos|mobilité/i.test(sport || '') ? '🧘' : '🏃';
const statusText = value => value >= 80 ? 'Très bonne récupération' : value >= 55 ? 'Récupération correcte' : 'Récupération à surveiller';

function formatDate(value, options = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!value) return 'Sans date';
  return new Intl.DateTimeFormat('fr-FR', options).format(new Date(`${value}T12:00:00`));
}

function formatToday(value) {
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${value}T12:00:00`));
}

function localDateIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: currentUser?.timezone || 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function metricsAreLive(data) {
  if (typeof data?.meta?.metricsFresh === 'boolean') return data.meta.metricsFresh;
  return ['connected', 'external'].includes(data?.meta?.corosMode);
}

function exactTodaySession(data) {
  const today = data?.meta?.today;
  if (!today) return null;
  return (data?.activePlan?.sessions || []).find(session => session.date === today) || null;
}

function objectiveProgress(data) {
  const plan = data.activePlan;
  const objective = data.activeObjective;
  if (!plan?.startDate || !objective?.date) return 0;
  const start = new Date(`${plan.startDate}T00:00:00`);
  const end = new Date(`${objective.date}T00:00:00`);
  const now = new Date(`${data.meta.today}T00:00:00`);
  if (!(end > start)) return 0;
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

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || `Erreur ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return body;
}

function installV5Ui() {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/v5-auth.css';
  document.head.appendChild(link);

  document.body.insertAdjacentHTML('beforeend', `
    <section class="v5-auth" id="v5Auth" aria-live="polite">
      <div class="v5-auth-card">
        <div class="v5-brand"><span>✦</span><div><strong>Coach</strong><small>Ton entraînement, tes données, ton coach.</small></div></div>
        <div class="v5-auth-tabs">
          <button type="button" class="active" data-auth-tab="login">Connexion</button>
          <button type="button" data-auth-tab="register">Créer un compte</button>
        </div>
        <form id="v5LoginForm" class="v5-auth-form">
          <label>Email<input type="email" name="email" autocomplete="email" required /></label>
          <label>Mot de passe<input type="password" name="password" autocomplete="current-password" required /></label>
          <button class="button primary full" type="submit">Se connecter</button>
        </form>
        <form id="v5RegisterForm" class="v5-auth-form hidden">
          <label>Prénom / nom<input name="displayName" autocomplete="name" required minlength="2" /></label>
          <label>Email<input type="email" name="email" autocomplete="email" required /></label>
          <label>Mot de passe<input type="password" name="password" autocomplete="new-password" required minlength="10" /></label>
          <label>Code d’invitation<input name="inviteCode" autocomplete="one-time-code" required /></label>
          <button class="button primary full" type="submit">Créer mon compte</button>
        </form>
        <p id="v5AuthStatus" class="v5-auth-status"></p>
      </div>
    </section>

    <dialog id="v5FeedbackDialog" class="v5-dialog">
      <form id="v5FeedbackForm" class="v5-dialog-card">
        <div class="v5-dialog-head"><div><small>RESSENTI</small><h2>Comment s’est passée la séance ?</h2></div><button type="button" id="v5FeedbackClose">×</button></div>
        <label>RPE (1–10)<input type="number" name="rpe" min="1" max="10" required /></label>
        <label>Jambes<select name="legs" required><option value="">Choisir</option><option>Légères</option><option>Normales</option><option>Lourdes</option><option>Très lourdes</option></select></label>
        <label>Cardio<select name="cardio" required><option value="">Choisir</option><option>Facile</option><option>Normal</option><option>Difficile</option></select></label>
        <label>Douleur / gêne<input name="pain" placeholder="Aucune, mollet, genou…" required /></label>
        <label>Tu pouvais continuer ?<select name="couldContinue" required><option value="">Choisir</option><option>Oui facilement</option><option>Un peu</option><option>Non</option></select></label>
        <label>Note<textarea name="note" rows="3" placeholder="Optionnel"></textarea></label>
        <button class="button primary full" type="submit">Enregistrer mon ressenti</button>
        <p id="v5FeedbackStatus" class="form-status"></p>
      </form>
    </dialog>
  `);

  $$('[data-auth-tab]').forEach(button => button.addEventListener('click', () => {
    $$('[data-auth-tab]').forEach(item => item.classList.toggle('active', item === button));
    $('#v5LoginForm').classList.toggle('hidden', button.dataset.authTab !== 'login');
    $('#v5RegisterForm').classList.toggle('hidden', button.dataset.authTab !== 'register');
    $('#v5AuthStatus').textContent = '';
  }));

  $('#v5LoginForm').addEventListener('submit', login);
  $('#v5RegisterForm').addEventListener('submit', register);
  $('#v5FeedbackClose').addEventListener('click', () => $('#v5FeedbackDialog').close());
  $('#v5FeedbackForm').addEventListener('submit', submitFeedback);
}

function showAuth(message = '') {
  $('#v5Auth').classList.add('visible');
  $('#v5AuthStatus').textContent = message;
  document.body.classList.add('v5-auth-locked');
}

function hideAuth() {
  $('#v5Auth').classList.remove('visible');
  document.body.classList.remove('v5-auth-locked');
}

async function login(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  $('#v5AuthStatus').textContent = 'Connexion…';
  try {
    const result = await api('/auth/login', { method: 'POST', body: JSON.stringify(payload) });
    currentUser = result.user;
    hideAuth();
    decorateUser();
    await load();
  } catch (error) {
    $('#v5AuthStatus').textContent = error.message;
  }
}

async function register(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  payload.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
  payload.locale = navigator.language || 'fr-FR';
  $('#v5AuthStatus').textContent = 'Création du compte…';
  try {
    const result = await api('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
    currentUser = result.user;
    hideAuth();
    decorateUser();
    await load();
  } catch (error) {
    $('#v5AuthStatus').textContent = error.message;
  }
}

async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => {});
  currentUser = null;
  appData = null;
  showAuth('Tu es déconnecté.');
}

function decorateUser() {
  if (!currentUser) return;
  $('#screenTitle').textContent = `Bonjour ${currentUser.displayName?.split(/\s+/)[0] || ''} 👋`;
  const avatar = $('#profileButton span');
  if (avatar) avatar.textContent = currentUser.initials || '☺';

  const profile = $('#profileDialog .sheet-content');
  if (profile && !$('#v5AccountBlock')) {
    profile.insertAdjacentHTML('beforeend', `
      <div id="v5AccountBlock" class="v5-account-block">
        <div class="section-label">COMPTE</div>
        <div class="profile-list">
          <div><span>Utilisateur</span><strong id="v5ProfileName"></strong></div>
          <div><span>Email</span><strong id="v5ProfileEmail"></strong></div>
        </div>
        <div class="section-label">CONNEXIONS</div>
        <div id="v5ProviderList" class="v5-provider-list"></div>
        <button class="button ghost full" id="v5LogoutButton" type="button">Se déconnecter</button>
      </div>
    `);
    $('#v5LogoutButton').addEventListener('click', async () => {
      $('#profileDialog').close();
      await logout();
    });
  }
  $('#v5ProfileName').textContent = currentUser.displayName || '—';
  $('#v5ProfileEmail').textContent = currentUser.email || '—';
}

function renderProviders(data) {
  const target = $('#v5ProviderList');
  if (!target) return;
  const providers = ['coros', 'garmin'];
  target.innerHTML = providers.map(name => {
    const connection = (data.providers || []).find(item => item.provider === name);
    const connected = connection?.status === 'connected';
    const lastSync = connection?.lastSyncAt ? new Date(connection.lastSyncAt).toLocaleString('fr-FR') : 'Jamais';
    return `<div class="v5-provider-row"><div><strong>${name.toUpperCase()}</strong><small>${connected ? `Connecté · synchro ${lastSync}` : 'Non connecté'}</small></div><span class="${connected ? 'connected' : ''}">${connected ? '●' : '○'}</span></div>`;
  }).join('');
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
  $('#todayDetails').textContent = 'Aucune séance n’est datée pour aujourd’hui. Une ancienne séance ne sera jamais recyclée comme séance du jour.';
  ['#viewSessionButton', '#adaptBtn', '#doneBtn'].forEach(selector => { $(selector).disabled = true; });
}

function setTodaySession(session) {
  $('#todayTitle').textContent = session.title;
  $('#todaySport').textContent = session.sport;
  $('#todaySportIcon').textContent = sportEmoji(session.sport);
  $('#todayDuration').textContent = session.duration || '—';
  $('#todayZoneBpm').textContent = session.hrTarget || '—';
  $('#todayZoneName').textContent = session.zoneLabel || `Z${session.zone || ''}`;
  $('#todayRpe').textContent = session.rpeTarget || '—';
  $('#todayDetails').textContent = session.details || sessionObjective(session);
  ['#viewSessionButton', '#adaptBtn', '#doneBtn'].forEach(selector => { $(selector).disabled = false; });
}

function renderToday(data) {
  $('#todayDate').textContent = formatToday(data.meta.today);
  if (metricsAreLive(data) && data.metrics) {
    const recovery = Number(data.metrics.recovery);
    $('#recovery').textContent = Number.isFinite(recovery) ? `${recovery}%` : '—';
    $('#recoveryLabel').textContent = Number.isFinite(recovery) ? statusText(recovery) : 'Données indisponibles';
    $('#sleepDuration').textContent = data.metrics.sleepDuration || '—';
    $('#shortLoad').textContent = data.metrics.shortTermLoad ?? '—';
    $('#readinessInsight').textContent = recovery >= 80 ? 'Tu peux t’entraîner normalement aujourd’hui.' : recovery >= 55 ? 'Tu peux maintenir la séance prévue en restant attentif aux sensations.' : 'Ton état invite à réduire l’intensité aujourd’hui.';
  } else {
    $('#recovery').textContent = '—';
    $('#sleepDuration').textContent = '—';
    $('#shortLoad').textContent = '—';
    $('#recoveryLabel').textContent = data.meta?.metricsDate ? `Données du ${formatDate(data.meta.metricsDate, { day: 'numeric', month: 'short' })}` : 'Montre non synchronisée';
    $('#readinessInsight').textContent = 'Aucune métrique fraîche pour aujourd’hui : le coach ne les utilisera pas comme données du jour.';
  }

  const session = exactTodaySession(data);
  session ? setTodaySession(session) : setTodaySessionEmpty();

  const objective = data.activeObjective;
  const plan = data.activePlan;
  const progress = objectiveProgress(data);
  $('#activeObjectiveTitle').textContent = objective?.title || 'Aucun objectif actif';
  $('#activeObjectiveMeta').textContent = objective ? `${formatDate(objective.date)} · ${data.meta.daysToObjective ?? '—'} jours restants` : 'Ajoute un objectif pour construire ton plan';
  $('#activePlanPhase').textContent = plan?.phase || 'Plan à construire';
  $('#objectiveProgressLabel').textContent = `${progress}%`;
  $('#objectiveProgressBar').style.width = `${progress}%`;

  const sessions = plan?.sessions || [];
  const done = sessions.filter(session => session.status === 'completed').length;
  $('#weekProgressText').textContent = `${done} / ${sessions.length} séances terminées`;
  $('#weekDots').innerHTML = sessions.slice(0, 7).map(session => `<span class="${session.status === 'completed' ? 'done' : ''}"></span>`).join('');
  const future = sessions.filter(session => session.date && session.date >= data.meta.today && session.status !== 'completed').sort((a, b) => a.date.localeCompare(b.date));
  const next = future.find(session => /blocs|seuil|longue|allure|tempo/i.test(session.title)) || future[0];
  $('#nextKeySession').textContent = next ? `${next.day || ''} · ${next.title}` : 'Plan à prolonger';
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
  $('#planWeek').textContent = plan?.totalWeeks ? `Semaine ${plan.currentWeek || '—'}` : 'Plan';
  const dates = (plan?.sessions || []).map(session => session.date).filter(Boolean).sort();
  $('#planWeekDates').textContent = dates.length ? `${formatDate(dates[0], { day: 'numeric', month: 'short' })} – ${formatDate(dates.at(-1), { day: 'numeric', month: 'short' })}` : 'Aucune séance planifiée';
  $('#week').innerHTML = (plan?.sessions || []).length ? plan.sessions.map(session => `
    <button class="week-day ${session.date === data.meta.today ? 'today' : ''}" type="button" data-session-id="${session.id}">
      <div class="day-badge"><span>${esc(session.day || '')}</span><strong>${session.date ? new Date(`${session.date}T12:00:00`).getDate() : ''}</strong></div>
      <div class="week-main"><strong>${sportEmoji(session.sport)} ${esc(session.title)}</strong><span>${esc(session.sport)} · ${esc(session.duration || '—')}${session.hrTarget ? ` · ${esc(session.hrTarget)}` : ''}</span></div>
      <span class="week-chevron">›</span>
    </button>`).join('') : '<article class="card v5-empty"><strong>Plan à construire</strong><p>Aucune séance n’est encore programmée.</p></article>';
  $$('[data-session-id]').forEach(button => button.addEventListener('click', () => showSessionDetail(button.dataset.sessionId)));
}

function renderProgress(data) {
  if (metricsAreLive(data) && data.metrics) {
    const ratio = Number(data.metrics.loadRatio);
    $('#formStateLabel').textContent = ratio > 1.3 ? 'Charge élevée' : ratio < 0.75 ? 'Reprise progressive' : 'En progression';
    $('#formStateInsight').textContent = ratio < 0.75 ? 'Ta charge est plutôt légère : reconstruis progressivement.' : ratio > 1.3 ? 'Ta charge est élevée : récupération prioritaire.' : 'Ta charge est équilibrée.';
    $('#progressLoad').textContent = data.metrics.shortTermLoad ?? '—';
  } else {
    $('#formStateLabel').textContent = 'Données non fraîches';
    $('#formStateInsight').textContent = 'La forme actuelle n’est pas interprétée sans métriques datées d’aujourd’hui.';
    $('#progressLoad').textContent = '—';
  }
  $('#progressVo2').textContent = data.metrics?.vo2max ?? '—';
  $('#progressThresholdHr').textContent = data.heartRateZones?.thresholdHr ?? data.metrics?.thresholdHr ?? '—';
  $('#progressThresholdPace').textContent = data.metrics?.thresholdPace ?? '—';

  const activity = data.latestActivity;
  if (activity) {
    $('#latestSport').textContent = activity.sport;
    $('#latestDate').textContent = formatDate(activity.date, { weekday: 'long', day: 'numeric', month: 'long' });
    $('#activityKpis').innerHTML = [[activity.distance || '—', 'Distance'], [activity.duration || '—', 'Durée'], [activity.pace || '—', 'Allure'], [activity.avgHr ? `${activity.avgHr} bpm` : '—', 'FC moy.']].map(([value, label]) => `<div class="activity-kpi"><strong>${esc(value)}</strong><span>${label}</span></div>`).join('');
    $('#latestFocus').textContent = activity.trainingFocus || 'Activité';
    $('#coachNote').textContent = activity.coachNote || 'Analyse disponible avec le coach.';
  } else {
    $('#latestSport').textContent = 'Aucune activité';
    $('#latestDate').textContent = 'Synchronise ta montre pour commencer';
    $('#activityKpis').innerHTML = '';
    $('#latestFocus').textContent = '—';
    $('#coachNote').textContent = 'Les nouvelles activités apparaîtront ici après synchronisation.';
  }

  const zones = data.heartRateZones?.zones || [];
  $('#zoneModel').textContent = `${data.heartRateZones?.source || 'Montre'} · ${data.heartRateZones?.model || 'Zones'} · FC seuil ${data.heartRateZones?.thresholdHr || '—'} bpm`;
  $('#heartRateZones').innerHTML = zones.map(zone => `<div class="zone-row"><b>Z${zone.zone}</b><span>${esc(zone.name)}</span><strong>${esc(zone.range)}</strong></div>`).join('');
}

function renderCoach(data) {
  $('#coachGoal').textContent = data.activeObjective?.title || 'Aucun objectif';
  $('#coachPhase').textContent = data.activePlan?.phase || 'Entre deux plans';
  $('#coachRecovery').textContent = metricsAreLive(data) && data.metrics ? `${data.metrics.recovery}% · ${statusText(data.metrics.recovery)}` : 'Non disponible aujourd’hui';
  $('#coachLatest').textContent = data.latestActivity ? `${formatDate(data.latestActivity.date, { weekday: 'short', day: 'numeric', month: 'short' })} · ${data.latestActivity.sport}` : 'Aucune activité';
}

function renderProfile(data) {
  $('#profileApproach').textContent = data.athlete.approach || '—';
  $('#profileAvailability').textContent = data.athlete.availability || '—';
  $('#profileSports').textContent = (data.athlete.sports || []).join(' · ') || '—';
  $('#profileInjury').textContent = data.athlete.injuryNotes || 'Aucune vigilance particulière';
  $('#profileThresholdHr').textContent = `${data.heartRateZones?.thresholdHr || data.metrics?.thresholdHr || '—'} bpm`;
  renderProviders(data);
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
  $('#goalList').innerHTML = others.length ? others.map(item => `<div class="goal-list-item"><div><h3>${esc(item.title)}</h3><p>${item.status === 'completed' ? 'Terminé' : `${esc(item.sport)} · ${formatDate(item.date)}`}</p></div>${item.status === 'completed' ? '<span>✓</span>' : `<button class="button ghost" type="button" data-activate-objective="${item.id}">Activer</button>`}</div>`).join('') : '<div class="goal-list-item"><div><h3>Aucun autre objectif</h3><p>Ajoute ton prochain défi quand tu veux.</p></div></div>';
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
  const data = await api('/api/v5/dashboard');
  render(data);
}

async function safeReload() {
  if (!currentUser) return;
  try { await load(); } catch (error) {
    if (error.status === 401) return showAuth('Ta session a expiré.');
    console.error(error);
    $('#readinessInsight').textContent = 'Impossible de charger les données.';
  }
}

function showSessionDetail(id) {
  const session = (appData?.activePlan?.sessions || []).find(item => item.id === String(id));
  if (!session) return;
  $('#detailSport').textContent = session.sport;
  $('#detailTitle').textContent = session.title;
  $('#detailDate').textContent = `${formatDate(session.date, { weekday: 'long', day: 'numeric', month: 'long' })} · ${session.duration || '—'}`;
  $('#detailObjective').textContent = sessionObjective(session);
  $('#detailHr').textContent = session.hrTarget || '—';
  $('#detailZone').textContent = session.zoneLabel || `Z${session.zone || ''}`;
  $('#detailRpe').textContent = session.rpeTarget || '—';
  $('#detailPace').textContent = session.paceTarget || 'Libre';
  $('#detailCoachTip').textContent = session.details || sessionObjective(session);
  const timeline = /blocs|allure/i.test(session.title) ? [['00:00', 'Échauffement', '15 min facile'], ['15:00', 'Bloc spécifique', 'Travail à l’allure cible'], ['47:00', 'Retour au calme', '10 min facile']] : [['00:00', 'Échauffement', '10 min facile'], ['10:00', session.title, 'Intensité cible'], ['35:00', 'Retour au calme', '5–10 min']];
  $('#sessionTimeline').innerHTML = timeline.map(([time, title, detail]) => `<div class="timeline-item"><div class="timeline-time">${time}</div><div class="timeline-marker"></div><div class="timeline-copy"><strong>${esc(title)}</strong><span>${esc(detail)}</span></div></div>`).join('');
  $('#detailDoneButton').dataset.sessionId = session.id;
  openDetail('sessionDetail');
}

function showActivityDetail() {
  const activity = appData?.latestActivity;
  if (!activity) return;
  $('#activityDetailSport').textContent = activity.sport;
  $('#activityDetailDate').textContent = formatDate(activity.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  $('#activityDetailKpis').innerHTML = [[activity.distance || '—', 'Distance'], [activity.duration || '—', 'Durée'], [activity.pace || '—', 'Allure']].map(([value, label]) => `<div><strong>${esc(value)}</strong><span>${label}</span></div>`).join('');
  $('#activityAvgHr').textContent = activity.avgHr ? `${activity.avgHr} bpm` : '—';
  $('#activityMaxHr').textContent = activity.maxHr ? `${activity.maxHr} bpm` : '—';
  $('#activityCoachAnalysis').textContent = activity.coachNote || 'Le coach peut analyser cette séance à partir de tes données.';
  openDetail('activityDetail');
}

async function activateObjective(id) {
  try {
    await api(`/api/v5/objectives/${encodeURIComponent(id)}/activate`, { method: 'POST' });
    await safeReload();
  } catch (error) { alert(error.message); }
}

async function createObjective() {
  const form = $('#objectiveForm');
  if (!form.reportValidity()) return;
  const payload = Object.fromEntries(new FormData(form));
  $('#objectiveStatus').textContent = 'Création…';
  try {
    await api('/api/v5/objectives', { method: 'POST', body: JSON.stringify(payload) });
    $('#objectiveDialog').close();
    form.reset();
    $('#objectiveStatus').textContent = '';
    await safeReload();
  } catch (error) { $('#objectiveStatus').textContent = error.message; }
}

async function completeTodaySession(id = appData?.todaySession?.id) {
  if (!id) return;
  try {
    await api(`/api/v5/sessions/${encodeURIComponent(id)}/complete`, { method: 'POST' });
    closeDetail($('#sessionDetail'));
    await safeReload();
    setScreen('progress');
  } catch (error) { alert(error.message); }
}

async function sendCoachMessage(message) {
  const text = String(message || '').trim();
  if (!text) return;
  $('#chatThread').insertAdjacentHTML('beforeend', `<div class="bubble user-bubble"><div>${esc(text)}</div></div>`);
  const loading = document.createElement('div');
  loading.className = 'bubble coach-bubble';
  loading.innerHTML = '<span class="bubble-avatar">✦</span><div>Analyse…</div>';
  $('#chatThread').appendChild(loading);
  $('#coachInput').value = '';
  try {
    const body = await api('/api/v5/coach', { method: 'POST', body: JSON.stringify({ message: text, threadId: coachThreadId }) });
    coachThreadId = body.threadId;
    loading.querySelector('div').textContent = body.reply;
  } catch (error) { loading.querySelector('div').textContent = error.message; }
}

function openFeedback() {
  if (!appData?.latestActivity) return;
  $('#v5FeedbackStatus').textContent = '';
  $('#v5FeedbackForm').reset();
  $('#v5FeedbackDialog').showModal();
}

async function submitFeedback(event) {
  event.preventDefault();
  const activity = appData?.latestActivity;
  if (!activity) return;
  const payload = Object.fromEntries(new FormData(event.currentTarget));
  $('#v5FeedbackStatus').textContent = 'Enregistrement…';
  try {
    await api(`/api/v5/activities/${activity.id}/feedback`, { method: 'POST', body: JSON.stringify(payload) });
    $('#v5FeedbackDialog').close();
  } catch (error) { $('#v5FeedbackStatus').textContent = error.message; }
}

async function bootstrap() {
  try {
    const result = await api('/auth/me');
    currentUser = result.user;
    decorateUser();
    hideAuth();
    await load();
  } catch (error) {
    if (error.status === 401) return showAuth();
    showAuth('Impossible de joindre le serveur.');
  }
}

function bindApp() {
  $$('.nav-item').forEach(item => item.addEventListener('click', () => setScreen(item.dataset.screen)));
  $$('[data-close-detail]').forEach(button => button.addEventListener('click', () => closeDetail(button.closest('.detail-view'))));
  $$('[data-open-progress]').forEach(button => button.addEventListener('click', () => setScreen('progress')));
  $('#viewSessionButton').addEventListener('click', () => showSessionDetail(appData?.todaySession?.id));
  $('#doneBtn').addEventListener('click', () => completeTodaySession());
  $('#detailDoneButton').addEventListener('click', event => completeTodaySession(event.currentTarget.dataset.sessionId));

  const openAdapt = () => {
    if (!appData?.todaySession) return;
    selectedAdaptation = '';
    $$('[data-adapt-choice]').forEach(item => item.classList.remove('selected'));
    $('#adaptNote').value = '';
    $('#adaptSheet').showModal();
  };
  $('#adaptBtn').addEventListener('click', openAdapt);
  $('#detailAdaptButton').addEventListener('click', openAdapt);
  $$('[data-adapt-choice]').forEach(button => button.addEventListener('click', () => {
    selectedAdaptation = button.dataset.adaptChoice;
    $$('[data-adapt-choice]').forEach(item => item.classList.toggle('selected', item === button));
  }));
  $('#askAdaptationButton').addEventListener('click', async () => {
    const note = $('#adaptNote').value.trim();
    $('#adaptSheet').close();
    setScreen('coach');
    await sendCoachMessage(`Propose une adaptation de ma séance d'aujourd'hui sans modifier le plan tant que je ne l'ai pas validée. ${selectedAdaptation}${note ? `. Détail : ${note}` : ''}`);
  });

  $('#manageGoalFromToday').addEventListener('click', () => openDetail('goalDetail'));
  $('#manageGoalButton').addEventListener('click', () => openDetail('goalDetail'));
  $('#goalViewPlanButton').addEventListener('click', () => { closeDetail($('#goalDetail')); setScreen('plan'); });
  $('#newGoalButton').addEventListener('click', () => $('#objectiveDialog').showModal());
  $('#newObjectiveButton').addEventListener('click', () => $('#objectiveDialog').showModal());
  $('#viewActivityButton').addEventListener('click', showActivityDetail);
  $('#activityFeedbackButton').addEventListener('click', () => { closeDetail($('#activityDetail')); openFeedback(); });
  $('#toggleZonesButton').addEventListener('click', () => $('#zonesCard').classList.toggle('hidden'));
  $('#profileButton').addEventListener('click', () => $('#profileDialog').showModal());
  $('#closeProfileButton').addEventListener('click', () => $('#profileDialog').close());
  $('#closeObjectiveButton').addEventListener('click', () => $('#objectiveDialog').close());
  $('#createObjectiveButton').addEventListener('click', createObjective);
  $$('[data-prompt]').forEach(button => button.addEventListener('click', async () => { setScreen('coach'); await sendCoachMessage(button.dataset.prompt); }));
  $('#coachForm').addEventListener('submit', async event => { event.preventDefault(); await sendCoachMessage($('#coachInput').value); });

  window.addEventListener('pageshow', () => safeReload());
  window.addEventListener('focus', () => safeReload());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') safeReload(); });
  setInterval(() => { if (currentUser && localDateIso() !== lastLoadedDay) safeReload(); }, 60_000);
}

installV5Ui();
bindApp();
bootstrap();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
