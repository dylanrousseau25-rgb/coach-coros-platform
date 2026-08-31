let freshnessLoadedDay = '';

function runtimeLocalDateIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function runtimeFormatToday(value) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long'
  }).format(new Date(`${value}T12:00:00`));
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function setNoTodaySession() {
  const values = {
    '#todayTitle': 'Aucune séance planifiée',
    '#todaySport': 'Le plan doit être prolongé',
    '#todaySportIcon': '🗓️',
    '#todayDuration': '—',
    '#todayZoneBpm': '—',
    '#todayZoneName': '—',
    '#todayRpe': '—',
    '#todayDetails': 'Aucune séance n’est datée pour aujourd’hui. Le coach ne recycle plus une ancienne séance.'
  };
  for (const [selector, value] of Object.entries(values)) setText(selector, value);
  for (const selector of ['#viewSessionButton', '#adaptBtn', '#doneBtn']) {
    const button = document.querySelector(selector);
    if (button) button.disabled = true;
  }
}

function maskDemoMetrics() {
  const values = {
    '#recovery': '—',
    '#sleepDuration': '—',
    '#shortLoad': '—',
    '#recoveryLabel': 'COROS non synchronisé',
    '#readinessInsight': 'Les métriques COROS du prototype ne sont pas des données du jour. Elles restent masquées tant que la synchronisation réelle n’est pas active.',
    '#formStateLabel': 'COROS non synchronisé',
    '#formStateInsight': 'La forme, la charge et les indicateurs physiologiques ne sont pas disponibles sans synchronisation COROS réelle.',
    '#progressVo2': '—',
    '#progressThresholdHr': '—',
    '#progressThresholdPace': '—',
    '#progressLoad': '—',
    '#coachRecovery': 'Non synchronisé',
    '#profileThresholdHr': 'Non synchronisé',
    '#zoneModel': 'Zones COROS non synchronisées',
    '#latestSport': 'Activité non synchronisée',
    '#latestDate': 'Connecte COROS pour importer tes activités',
    '#latestFocus': '—',
    '#coachNote': 'La dernière activité affichée dans le prototype n’est pas considérée comme une donnée actuelle tant que COROS n’est pas synchronisé.'
  };
  for (const [selector, value] of Object.entries(values)) setText(selector, value);

  const cards = [...document.querySelectorAll('.metric-card')];
  for (const card of cards) {
    const small = card.querySelector('small');
    if (small) small.textContent = 'non synchronisé';
  }

  const activityKpis = document.querySelector('#activityKpis');
  if (activityKpis) {
    activityKpis.innerHTML = ['Distance', 'Durée', 'Allure', 'FC moy.']
      .map(label => `<div class="activity-kpi"><strong>—</strong><span>${label}</span></div>`)
      .join('');
  }

  const activityButton = document.querySelector('#viewActivityButton');
  if (activityButton) activityButton.disabled = true;

  const zones = document.querySelector('#heartRateZones');
  if (zones) zones.innerHTML = '<div class="zone-row"><span>Synchronise COROS pour charger tes zones réelles.</span></div>';

  const toggleZones = document.querySelector('#toggleZonesButton');
  if (toggleZones) toggleZones.textContent = 'Non synchronisé';
}

async function applyFreshnessGuard({ reload = false } = {}) {
  try {
    if (reload && typeof load === 'function') await load();
    const response = await fetch('/api/dashboard', { cache: 'no-store' });
    if (!response.ok) throw new Error(`Dashboard ${response.status}`);
    const data = await response.json();
    freshnessLoadedDay = data.meta?.today || runtimeLocalDateIso();

    const todayDate = document.querySelector('#todayDate');
    if (todayDate) todayDate.textContent = runtimeFormatToday(freshnessLoadedDay);

    if (!data.meta?.corosMode || data.meta.corosMode === 'demo') maskDemoMetrics();

    const sessions = data.activePlan?.sessions || [];
    const todaySession = sessions.find(session => session.date === freshnessLoadedDay) || null;
    if (!todaySession) setNoTodaySession();

    document.querySelectorAll('[data-session-id]').forEach(button => button.classList.remove('today'));
    if (todaySession) {
      document.querySelector(`[data-session-id="${CSS.escape(todaySession.id)}"]`)?.classList.add('today');
    }

    const futureSessions = sessions
      .filter(session => session.date && session.date >= freshnessLoadedDay && session.status !== 'completed')
      .sort((a, b) => a.date.localeCompare(b.date));
    const nextKey = futureSessions.find(session => /blocs|seuil|longue|allure|tempo/i.test(session.title)) || futureSessions[0];
    const nextKeyElement = document.querySelector('#nextKeySession');
    if (nextKeyElement) nextKeyElement.textContent = nextKey ? `${nextKey.day || ''} · ${nextKey.title}` : 'Plan à prolonger';
  } catch (error) {
    console.error('Freshness guard', error);
  }
}

window.addEventListener('pageshow', () => applyFreshnessGuard({ reload: true }));
window.addEventListener('focus', () => applyFreshnessGuard({ reload: true }));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') applyFreshnessGuard({ reload: true });
});
setInterval(() => {
  if (runtimeLocalDateIso() !== freshnessLoadedDay) applyFreshnessGuard({ reload: true });
}, 60_000);
setTimeout(() => applyFreshnessGuard(), 300);

if (!document.querySelector('script[data-coros-runtime]')) {
  const corosScript = document.createElement('script');
  corosScript.src = '/coros-runtime.js';
  corosScript.dataset.corosRuntime = 'true';
  document.head.appendChild(corosScript);
}

if (!document.querySelector('script[data-coach-polish]')) {
  const coachPolishScript = document.createElement('script');
  coachPolishScript.src = '/coach-polish.js';
  coachPolishScript.dataset.coachPolish = 'true';
  document.head.appendChild(coachPolishScript);
}
