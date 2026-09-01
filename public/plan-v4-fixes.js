(() => {
  const $ = selector => document.querySelector(selector);
  const todayIso = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  function formatDate(iso) {
    if (!iso) return '—';
    try {
      return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
        .format(new Date(`${iso}T12:00:00`));
    } catch { return iso; }
  }

  function ensureStartDateField() {
    const form = $('#objectiveForm');
    if (!form || $('#objectiveStartDate')) return;
    const eventDate = $('#objectiveDate');
    const eventLabel = eventDate?.closest('label');
    if (!eventLabel) return;

    const label = document.createElement('label');
    label.className = 'input-label';
    label.innerHTML = `Date de début du plan
      <input name="startDate" id="objectiveStartDate" type="date" required />
      <small style="display:block;margin-top:6px;color:#7b8798;line-height:1.35">Aucune séance du plan ne sera programmée avant cette date.</small>`;
    eventLabel.insertAdjacentElement('beforebegin', label);

    const input = $('#objectiveStartDate');
    const syncDates = () => {
      const today = todayIso();
      input.min = today;
      input.max = eventDate?.value || '';
      if (!input.value || input.value < today) input.value = today;
      if (eventDate?.value && input.value > eventDate.value) input.value = eventDate.value;
    };
    eventDate?.addEventListener('change', syncDates);
    syncDates();
  }

  function ensureActivationDialog() {
    let dialog = $('#planActivationDialog');
    if (dialog) return dialog;
    dialog = document.createElement('dialog');
    dialog.className = 'bottom-sheet';
    dialog.id = 'planActivationDialog';
    dialog.innerHTML = `
      <form class="sheet-content" id="planActivationForm">
        <div class="sheet-handle"></div>
        <div class="sheet-head">
          <div>
            <span class="eyebrow">ACTIVER LE PLAN</span>
            <h2 id="planActivationTitle">Choisir le démarrage</h2>
            <p class="profile-subtitle">Le Coach recalculera la préparation si tu modifies la date de départ.</p>
          </div>
          <button id="planActivationClose" type="button">×</button>
        </div>
        <label class="input-label">Date de début du plan
          <input id="planActivationStartDate" type="date" required />
        </label>
        <div id="planActivationInfo" style="padding:12px;border-radius:14px;background:#f5f8ff;color:#526987;font-size:.86rem;line-height:1.45"></div>
        <div class="split-actions">
          <button class="button ghost" id="planActivationCancel" type="button">Annuler</button>
          <button class="button primary" id="planActivationConfirm" type="submit">Activer ce plan</button>
        </div>
        <p class="form-status" id="planActivationStatus"></p>
      </form>`;
    document.body.appendChild(dialog);
    $('#planActivationClose').onclick = () => dialog.close();
    $('#planActivationCancel').onclick = () => dialog.close();
    return dialog;
  }

  async function dashboard() {
    const response = await fetch('/api/dashboard', { cache: 'no-store' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Impossible de charger les objectifs.');
    return body;
  }

  async function persistStartDate(data, objective, plan, startDate) {
    const objectives = (data.objectives || []).map(item => item.id === objective.id ? { ...item, startDate } : item);
    const plans = (data.plans || []).map(item => item.id === plan?.id ? { ...item, startDate } : item);
    const response = await fetch('/api/plans/continuity/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        deletedObjectiveIds: data.deletedObjectiveIds || [],
        objectives,
        plans,
        planVersions: data.planVersions || [],
        planProposals: data.planProposals || []
      })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Impossible d’enregistrer la date de début.');
  }

  async function rebuildObjective(objectiveId) {
    const response = await fetch(`/api/objectives/${encodeURIComponent(objectiveId)}/regenerate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Impossible de recalculer le plan.');
    return body;
  }

  async function activateObjectiveNow(objectiveId) {
    const response = await fetch(`/api/objectives/${encodeURIComponent(objectiveId)}/activate`, { method: 'POST' });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Impossible d’activer le plan.');
    await window.coachPlanContinuity?.capture();
    if (typeof safeReload === 'function') await safeReload();
    if (typeof setScreen === 'function') setScreen('plan');
    return body;
  }

  async function openActivation(objectiveId) {
    const data = await dashboard();
    const objective = (data.objectives || []).find(item => item.id === objectiveId);
    if (!objective) throw new Error('Objectif introuvable.');
    const plan = (data.plans || []).find(item => item.id === objective.planId) || null;
    if (!plan) throw new Error('Le plan associé est introuvable.');

    const dialog = ensureActivationDialog();
    const input = $('#planActivationStartDate');
    const today = todayIso();
    const currentStart = objective.startDate || plan.startDate || today;
    input.min = today;
    input.max = objective.date || '';
    input.value = currentStart < today ? today : currentStart;
    if (objective.date && input.value > objective.date) input.value = objective.date;
    $('#planActivationTitle').textContent = objective.title || 'Activer le plan';
    $('#planActivationInfo').textContent = `Course / objectif : ${formatDate(objective.date)}. Début proposé : ${formatDate(input.value)}.`;
    $('#planActivationStatus').textContent = '';

    input.onchange = () => {
      $('#planActivationInfo').textContent = `Le plan sera recalculé du ${formatDate(input.value)} au ${formatDate(objective.date)}.`;
    };

    const form = $('#planActivationForm');
    form.onsubmit = async event => {
      event.preventDefault();
      const startDate = input.value;
      const status = $('#planActivationStatus');
      const confirm = $('#planActivationConfirm');
      if (!startDate) return;
      if (objective.date && startDate > objective.date) {
        status.textContent = 'La date de début doit être antérieure à la course.';
        return;
      }
      confirm.disabled = true;
      status.textContent = 'Préparation du plan…';
      try {
        const mustRebuild = startDate !== objective.startDate || startDate !== plan.startDate;
        if (mustRebuild) {
          await persistStartDate(data, objective, plan, startDate);
          status.textContent = 'Le Coach recalcule le plan depuis cette date…';
          await rebuildObjective(objective.id);
        }
        status.textContent = 'Activation…';
        await activateObjectiveNow(objective.id);
        status.textContent = 'Plan actif ✓';
        setTimeout(() => dialog.close(), 250);
      } catch (error) {
        console.error(error);
        status.textContent = error.message || 'Activation impossible.';
      } finally {
        confirm.disabled = false;
      }
    };
    dialog.showModal();
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-activate-objective]');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openActivation(button.dataset.activateObjective).catch(error => alert(error.message || 'Activation impossible.'));
  }, true);

  // Le plan-continuity local ne doit jamais annuler visuellement une activation réussie.
  const previousFetch = window.fetch.bind(window);
  window.fetch = async function(input, init) {
    const response = await previousFetch(input, init);
    try {
      const url = typeof input === 'string' ? input : input?.url || '';
      const method = String(init?.method || input?.method || 'GET').toUpperCase();
      if (response.ok && method === 'POST' && /\/api\/objectives\/[^/]+\/activate(?:\?|$)/.test(url)) {
        await window.coachPlanContinuity?.capture();
      }
    } catch (error) {
      console.warn('Activation continuity', error);
    }
    return response;
  };

  const refresh = () => setTimeout(ensureStartDateField, 80);
  document.addEventListener('click', event => {
    if (event.target.closest('#newGoalButton,#newObjectiveButton')) refresh();
  });
  window.addEventListener('pageshow', refresh);
  setTimeout(ensureStartDateField, 650);
})();