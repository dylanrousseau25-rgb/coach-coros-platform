const runtimeFeedbackState = { activityId: null, sessionId: null };

function ensureFeedbackDialog() {
  if (document.querySelector('#feedbackDialog')) return document.querySelector('#feedbackDialog');
  const dialog = document.createElement('dialog');
  dialog.className = 'bottom-sheet';
  dialog.id = 'feedbackDialog';
  dialog.innerHTML = `
    <form class="sheet-content" id="feedbackForm">
      <div class="sheet-handle"></div>
      <div class="sheet-head">
        <div><span class="eyebrow">RESSENTI</span><h2>Comment ça s’est passé ?</h2></div>
        <button id="closeFeedbackButton" type="button">×</button>
      </div>
      <label class="input-label">Effort perçu (RPE)
        <select name="rpe" required>
          <option value="">Choisir</option>
          <option value="1">1 · Très facile</option><option value="2">2</option><option value="3">3 · Facile</option>
          <option value="4">4</option><option value="5">5 · Modéré</option><option value="6">6</option>
          <option value="7">7 · Difficile</option><option value="8">8</option><option value="9">9</option><option value="10">10 · Maximal</option>
        </select>
      </label>
      <label class="input-label">Jambes
        <select name="legs" required><option value="">Choisir</option><option>Légères</option><option>Normales</option><option>Lourdes</option></select>
      </label>
      <label class="input-label">Cardio / souffle
        <select name="cardio" required><option value="">Choisir</option><option>Facile</option><option>Normal</option><option>Difficile</option></select>
      </label>
      <label class="input-label">Douleur ou gêne
        <select name="pain" required><option value="">Choisir</option><option value="none">Aucune</option><option value="mild">Petite gêne</option><option value="pain">Douleur</option></select>
      </label>
      <label class="input-label">Tu aurais pu continuer ?
        <select name="couldContinue" required><option value="">Choisir</option><option value="yes">Oui</option><option value="no">Non</option></select>
      </label>
      <label class="input-label">Note optionnelle<textarea name="note" rows="3" placeholder="Sensations, douleur, météo, fatigue…"></textarea></label>
      <button class="button primary full" type="submit">Enregistrer mon ressenti</button>
      <p class="form-status" id="feedbackStatus"></p>
    </form>`;
  document.body.appendChild(dialog);
  dialog.querySelector('#closeFeedbackButton').addEventListener('click', () => dialog.close());
  dialog.querySelector('#feedbackForm').addEventListener('submit', submitFeedback);
  return dialog;
}

function openFeedback({ activityId = null, sessionId = null } = {}) {
  runtimeFeedbackState.activityId = activityId;
  runtimeFeedbackState.sessionId = sessionId;
  const dialog = ensureFeedbackDialog();
  dialog.querySelector('#feedbackForm').reset();
  dialog.querySelector('#feedbackStatus').textContent = '';
  dialog.showModal();
}

async function submitFeedback(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const payload = {
    ...values,
    rpe: Number(values.rpe),
    couldContinue: values.couldContinue === 'yes',
    activityId: runtimeFeedbackState.activityId,
    sessionId: runtimeFeedbackState.sessionId
  };
  const status = form.querySelector('#feedbackStatus');
  status.textContent = 'Enregistrement…';
  try {
    const response = await fetch('/api/feedback', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Impossible d’enregistrer le ressenti');
    status.textContent = 'Ressenti enregistré ✓';
    setTimeout(() => form.closest('dialog')?.close(), 450);
    if (typeof safeReload === 'function') await safeReload();
  } catch (error) {
    console.error(error);
    status.textContent = error.message || 'Erreur';
  }
}

async function getDashboardSnapshot() {
  const response = await fetch('/api/dashboard', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Dashboard ${response.status}`);
  return response.json();
}

async function completeTodaySession() {
  try {
    const data = await getDashboardSnapshot();
    const session = data.todaySession?.date === data.meta?.today
      ? data.todaySession
      : (data.activePlan?.sessions || []).find(item => item.date === data.meta?.today);
    if (!session) {
      alert('Aucune séance planifiée aujourd’hui.');
      return;
    }
    if (session.status !== 'completed') {
      const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}/complete`, { method: 'POST' });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Impossible de terminer la séance');
    }
    document.querySelector('#sessionDetail')?.classList.remove('open');
    document.body.style.overflow = '';
    await refreshCompletedUi();
    openFeedback({ sessionId: session.id });
  } catch (error) {
    console.error(error);
    alert(error.message || 'Erreur pendant la validation de la séance.');
  }
}

async function openLatestActivityFeedback() {
  try {
    const data = await getDashboardSnapshot();
    if (!data.latestActivity?.id) {
      alert('Aucune activité disponible.');
      return;
    }
    document.querySelector('#activityDetail')?.classList.remove('open');
    document.body.style.overflow = '';
    openFeedback({ activityId: data.latestActivity.id });
  } catch (error) {
    console.error(error);
    alert('Impossible de charger l’activité.');
  }
}

async function refreshCompletedUi() {
  try {
    const data = await getDashboardSnapshot();
    const session = (data.activePlan?.sessions || []).find(item => item.date === data.meta?.today);
    const done = session?.status === 'completed';
    const doneButton = document.querySelector('#doneBtn');
    const detailButton = document.querySelector('#detailDoneButton');
    if (doneButton) {
      doneButton.disabled = !session || done;
      doneButton.textContent = done ? '✓ Terminée' : 'J’ai terminé';
    }
    if (detailButton && session && document.querySelector('#detailTitle')?.textContent === session.title) {
      detailButton.disabled = done;
      detailButton.textContent = done ? '✓ Séance terminée' : 'J’ai terminé cette séance';
    }
    if (done) {
      const adapt = document.querySelector('#adaptBtn');
      if (adapt) adapt.disabled = true;
    }
  } catch (error) {
    console.error(error);
  }
}

const doneButton = document.querySelector('#doneBtn');
if (doneButton) doneButton.addEventListener('click', event => {
  event.preventDefault();
  event.stopImmediatePropagation();
  completeTodaySession();
}, { capture: true });

const detailDoneButton = document.querySelector('#detailDoneButton');
if (detailDoneButton) detailDoneButton.addEventListener('click', event => {
  event.preventDefault();
  event.stopImmediatePropagation();
  completeTodaySession();
}, { capture: true });

const feedbackButton = document.querySelector('#activityFeedbackButton');
if (feedbackButton) feedbackButton.addEventListener('click', event => {
  event.preventDefault();
  event.stopImmediatePropagation();
  openLatestActivityFeedback();
}, { capture: true });

document.addEventListener('click', event => {
  if (event.target.closest('#viewSessionButton,[data-session-id]')) setTimeout(refreshCompletedUi, 0);
});
window.addEventListener('pageshow', refreshCompletedUi);
window.addEventListener('focus', refreshCompletedUi);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshCompletedUi();
});
setTimeout(refreshCompletedUi, 250);
