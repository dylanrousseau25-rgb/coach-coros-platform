let corosSyncing = false;

function corosLocalDateIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function ensureCorosUi() {
  let row = document.querySelector('#corosConnectionRow');
  const profileList = document.querySelector('#profileDialog .profile-list');
  if (profileList && !row) {
    row = document.createElement('div');
    row.id = 'corosConnectionRow';
    row.innerHTML = '<span>COROS</span><strong id="corosConnectionLabel">Vérification…</strong>';
    profileList.appendChild(row);
  }

  let action = document.querySelector('#corosConnectionAction');
  const profileContent = document.querySelector('#profileDialog .sheet-content');
  if (profileContent && !action) {
    action = document.createElement('button');
    action.id = 'corosConnectionAction';
    action.type = 'button';
    action.className = 'button primary full';
    action.textContent = 'Connecter COROS';
    profileContent.appendChild(action);
    action.addEventListener('click', handleCorosAction);
  }

  let disconnect = document.querySelector('#corosDisconnectAction');
  if (profileContent && !disconnect) {
    disconnect = document.createElement('button');
    disconnect.id = 'corosDisconnectAction';
    disconnect.type = 'button';
    disconnect.className = 'text-link centered hidden';
    disconnect.textContent = 'Déconnecter COROS';
    profileContent.appendChild(disconnect);
    disconnect.addEventListener('click', disconnectCoros);
  }

  let inline = document.querySelector('#corosInlineAction');
  const statusCard = document.querySelector('.status-card');
  if (statusCard && !inline) {
    inline = document.createElement('button');
    inline.id = 'corosInlineAction';
    inline.type = 'button';
    inline.className = 'button primary full';
    inline.textContent = 'Connecter COROS';
    statusCard.appendChild(inline);
    inline.addEventListener('click', handleCorosAction);
  }
}

function formatSyncTime(value) {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value));
  } catch {
    return null;
  }
}

async function getCorosStatus() {
  const response = await fetch('/api/coros/status', { cache: 'no-store' });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Impossible de lire le statut COROS');
  return body;
}

function renderCorosStatus(status) {
  ensureCorosUi();
  const label = document.querySelector('#corosConnectionLabel');
  const action = document.querySelector('#corosConnectionAction');
  const inline = document.querySelector('#corosInlineAction');
  const disconnect = document.querySelector('#corosDisconnectAction');
  const syncedToday = status.connected && status.dataDate === corosLocalDateIso();
  const time = formatSyncTime(status.lastSyncAt);

  if (label) label.textContent = status.connected
    ? (syncedToday ? `Connecté · synchro ${time || 'aujourd’hui'}` : 'Connecté · synchronisation requise')
    : 'Non connecté';

  for (const button of [action, inline]) {
    if (!button) continue;
    button.disabled = corosSyncing;
    if (!status.connected) {
      button.textContent = 'Connecter COROS';
      button.dataset.corosMode = 'connect';
      button.classList.remove('hidden');
    } else if (!syncedToday) {
      button.textContent = corosSyncing ? 'Synchronisation…' : 'Synchroniser COROS';
      button.dataset.corosMode = 'sync';
      button.classList.remove('hidden');
    } else if (button === inline) {
      button.classList.add('hidden');
    } else {
      button.textContent = corosSyncing ? 'Synchronisation…' : 'Synchroniser maintenant';
      button.dataset.corosMode = 'sync';
      button.classList.remove('hidden');
    }
  }
  if (disconnect) disconnect.classList.toggle('hidden', !status.connected);
}

async function handleCorosAction(event) {
  const mode = event?.currentTarget?.dataset?.corosMode || 'connect';
  if (mode === 'connect') {
    window.location.assign('/api/coros/connect');
    return;
  }
  await syncCorosNow();
}

async function syncCorosNow({ silent = false } = {}) {
  if (corosSyncing) return;
  corosSyncing = true;
  try {
    const before = await getCorosStatus();
    renderCorosStatus(before);
    const response = await fetch('/api/coros/sync', { method: 'POST', headers: { accept: 'application/json' } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Synchronisation COROS impossible');
    if (typeof safeReload === 'function') await safeReload();
    if (typeof applyFreshnessGuard === 'function') await applyFreshnessGuard();
    polishActivityUi();
    const after = await getCorosStatus();
    renderCorosStatus(after);
    const insight = document.querySelector('#readinessInsight');
    if (insight && !silent) insight.textContent = 'Données COROS synchronisées ✓';
  } catch (error) {
    console.error('COROS sync', error);
    const insight = document.querySelector('#readinessInsight');
    if (insight) insight.textContent = `COROS : ${error.message || 'synchronisation impossible'}`;
  } finally {
    corosSyncing = false;
    try { renderCorosStatus(await getCorosStatus()); } catch {}
  }
}

async function disconnectCoros() {
  if (!window.confirm('Déconnecter COROS de cette app ?')) return;
  try {
    const response = await fetch('/api/coros/disconnect', { method: 'POST' });
    if (!response.ok) throw new Error('Déconnexion impossible');
    if (typeof safeReload === 'function') await safeReload();
    renderCorosStatus(await getCorosStatus());
  } catch (error) {
    console.error(error);
    window.alert(error.message || 'Déconnexion impossible');
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function polishActivityUi() {
  try {
    const activity = typeof appData !== 'undefined' ? appData?.latestActivity : null;
    const max = numberOrNull(activity?.maxHr);
    const avg = numberOrNull(activity?.avgHr);
    const maxElement = document.querySelector('#activityMaxHr');
    const avgElement = document.querySelector('#activityAvgHr');
    const dateElement = document.querySelector('#activityDetailDate');
    const analysisElement = document.querySelector('#activityCoachAnalysis');
    if (maxElement) maxElement.textContent = max === null ? '—' : `${max} bpm`;
    if (avgElement) avgElement.textContent = avg === null ? '—' : `${avg} bpm`;
    if (dateElement && activity?.date && typeof formatDate === 'function') {
      dateElement.textContent = formatDate(activity.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    }
    if (analysisElement && activity?.coachNote) analysisElement.textContent = activity.coachNote;

    const threshold = document.querySelector('#progressThresholdHr');
    const thresholdCard = threshold?.closest('.metric-card');
    const thresholdHint = thresholdCard?.querySelector('small');
    if (threshold && (threshold.textContent.trim() === '—' || !threshold.textContent.trim())) {
      if (thresholdHint) thresholdHint.textContent = 'non fournie par le MCP COROS';
    }
  } catch (error) {
    console.error('COROS UI polish', error);
  }
}

function activityCoachPrompt() {
  const activity = typeof appData !== 'undefined' ? appData?.latestActivity : null;
  if (!activity) return 'Analyse ma dernière activité COROS et explique ce qu’elle change pour ma prochaine séance.';
  return `Analyse précisément ma dernière activité COROS (${activity.date || 'date inconnue'}, ${activity.sport || 'activité'}, ${activity.distance || 'distance inconnue'}, ${activity.duration || 'durée inconnue'}, allure ${activity.pace || 'inconnue'}, FC moyenne ${activity.avgHr ?? 'inconnue'} bpm, FC max ${activity.maxHr ?? 'inconnue'} bpm). Explique la qualité de l’effort et ce que cela change pour ma prochaine séance.`;
}

async function analyzeLatestActivityWithCoach() {
  try {
    const dialog = document.querySelector('#activityActionsSheet');
    if (dialog?.open) dialog.close();
    if (typeof closeDetail === 'function') closeDetail(document.querySelector('#activityDetail'));
    if (typeof setScreen === 'function') setScreen('coach');
    if (typeof sendCoachMessage === 'function') await sendCoachMessage(activityCoachPrompt());
  } catch (error) {
    console.error(error);
    window.alert('Impossible de lancer l’analyse du Coach.');
  }
}

function ensureActivityActions() {
  let dialog = document.querySelector('#activityActionsSheet');
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'activityActionsSheet';
    dialog.className = 'bottom-sheet';
    dialog.innerHTML = `
      <div class="sheet-content">
        <div class="sheet-handle"></div>
        <div class="sheet-head"><div><span class="eyebrow">ACTIVITÉ</span><h2>Que veux-tu faire ?</h2></div></div>
        <button class="button primary full" id="activityAnalyzeCoachAction" type="button">✦ Analyser avec le Coach</button>
        <button class="button soft full" id="activityResyncAction" type="button">↻ Resynchroniser COROS</button>
        <button class="text-link centered" id="activityActionsClose" type="button">Fermer</button>
      </div>`;
    document.body.appendChild(dialog);
    dialog.querySelector('#activityAnalyzeCoachAction').addEventListener('click', analyzeLatestActivityWithCoach);
    dialog.querySelector('#activityResyncAction').addEventListener('click', async () => {
      dialog.close();
      await syncCorosNow();
      polishActivityUi();
    });
    dialog.querySelector('#activityActionsClose').addEventListener('click', () => dialog.close());
  }

  const more = document.querySelector('#activityDetail .more-button');
  if (more && !more.dataset.activityMenuBound) {
    more.dataset.activityMenuBound = '1';
    more.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      ensureActivityActions();
      dialog.showModal();
    });
  }

  const viewActivity = document.querySelector('#viewActivityButton');
  if (viewActivity && !viewActivity.dataset.activityPolishBound) {
    viewActivity.dataset.activityPolishBound = '1';
    viewActivity.addEventListener('click', () => setTimeout(polishActivityUi, 0));
  }
}

async function bootstrapCoros() {
  ensureCorosUi();
  ensureActivityActions();
  polishActivityUi();
  const params = new URLSearchParams(window.location.search);
  const callbackState = params.get('coros');
  if (callbackState) {
    const clean = `${window.location.pathname}${window.location.hash || ''}`;
    history.replaceState({}, '', clean || '/');
  }

  try {
    const status = await getCorosStatus();
    renderCorosStatus(status);
    if (callbackState === 'error') {
      const insight = document.querySelector('#readinessInsight');
      if (insight) insight.textContent = `Connexion COROS impossible : ${params.get('message') || 'réessaie depuis ton profil.'}`;
      return;
    }
    const stale = status.connected && status.dataDate !== corosLocalDateIso();
    const old = status.lastSyncAt && (Date.now() - new Date(status.lastSyncAt).getTime() > 15 * 60 * 1000);
    if (callbackState === 'connected' || stale || old) await syncCorosNow({ silent: callbackState !== 'connected' });
  } catch (error) {
    console.error('COROS bootstrap', error);
  }
}

window.addEventListener('pageshow', () => {
  ensureActivityActions();
  setTimeout(polishActivityUi, 0);
  getCorosStatus().then(status => {
    renderCorosStatus(status);
    const old = status.connected && (!status.lastSyncAt || Date.now() - new Date(status.lastSyncAt).getTime() > 15 * 60 * 1000);
    if (old) syncCorosNow({ silent: true });
  }).catch(() => {});
});

setTimeout(bootstrapCoros, 450);
setTimeout(() => { ensureActivityActions(); polishActivityUi(); }, 1200);
