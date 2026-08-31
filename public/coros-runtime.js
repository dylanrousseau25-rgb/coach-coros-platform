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

async function bootstrapCoros() {
  ensureCorosUi();
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
  getCorosStatus().then(status => {
    renderCorosStatus(status);
    const old = status.connected && (!status.lastSyncAt || Date.now() - new Date(status.lastSyncAt).getTime() > 15 * 60 * 1000);
    if (old) syncCorosNow({ silent: true });
  }).catch(() => {});
});

setTimeout(bootstrapCoros, 450);
