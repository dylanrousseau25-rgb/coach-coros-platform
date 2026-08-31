const COACH_ANALYSIS_PREFIX = 'coach-coros:activity-analysis:';
const WEEKLY_REVIEW_PREFIX = 'coach-coros:weekly-review:';
let coachPolishBusy = false;

function coachEsc(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function coachStructuredHtml(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const normalized = raw
    .replace(/\r/g, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/^#{1,4}\s*/gm, '');
  const lines = normalized.split('\n').map(line => line.trim()).filter(Boolean);
  const sections = [];
  let current = { title: '', items: [] };
  const titleRx = /^(Bilan(?: de la séance)?|Ce que ça montre|Impact sur le plan|À surveiller|Aujourd’hui|Cette semaine|Plan proposé|Recommandation|Résumé|Pourquoi|Prochaine étape|Revue hebdomadaire)\s*:?\s*$/i;
  for (const line of lines) {
    if (titleRx.test(line)) {
      if (current.title || current.items.length) sections.push(current);
      current = { title: line.replace(/:$/, ''), items: [] };
      continue;
    }
    const cleaned = line.replace(/^[-•]\s*/, '').replace(/^\d+[.)]\s*/, '');
    current.items.push(cleaned);
  }
  if (current.title || current.items.length) sections.push(current);
  if (sections.length === 1 && !sections[0].title && sections[0].items.length > 4) {
    const items = sections[0].items;
    sections.length = 0;
    sections.push({ title: 'Résumé', items: items.slice(0, 2) });
    sections.push({ title: 'Recommandation', items: items.slice(2) });
  }
  return `<div class="coach-structured">${sections.map(section => `
    <section>
      ${section.title ? `<strong>${coachEsc(section.title)}</strong>` : ''}
      ${section.items.length === 1 ? `<p>${coachEsc(section.items[0])}</p>` : `<ul>${section.items.map(item => `<li>${coachEsc(item)}</li>`).join('')}</ul>`}
    </section>`).join('')}</div>`;
}

function injectCoachPolishStyles() {
  if (document.querySelector('#coachPolishStyles')) return;
  const style = document.createElement('style');
  style.id = 'coachPolishStyles';
  style.textContent = `
    .coach-structured{display:grid;gap:12px;font-size:15px;line-height:1.45}
    .coach-structured section{display:grid;gap:5px}
    .coach-structured section>strong{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#315fae}
    .coach-structured p,.coach-structured ul{margin:0}
    .coach-structured ul{padding-left:18px;display:grid;gap:4px}
    .coach-bubble .coach-structured{min-width:0}
    .coach-auto-label{font-size:12px;color:#748094;margin-bottom:6px;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
  `;
  document.head.appendChild(style);
}

function polishCoachBubbles(root = document) {
  root.querySelectorAll?.('.coach-bubble > div:not([data-coach-structured])').forEach(element => {
    const text = element.textContent?.trim();
    if (!text || text === 'Analyse…' || /^Bonjour !/.test(text)) return;
    element.dataset.coachStructured = '1';
    element.innerHTML = coachStructuredHtml(text);
  });
}

function validBpm(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 30 && number < 240 ? Math.round(number) : null;
}

function inferMaxHr(activity) {
  const direct = validBpm(activity?.maxHr);
  if (direct) return direct;
  const note = String(activity?.coachNote || '');
  const patterns = [
    /peaking\s+at\s+(\d{2,3})\s*bpm/i,
    /(?:max(?:imum)?\s*(?:heart\s*rate|hr)|fc\s*max(?:imale)?)\D{0,12}(\d{2,3})\s*bpm/i
  ];
  for (const pattern of patterns) {
    const found = validBpm(note.match(pattern)?.[1]);
    if (found) return found;
  }
  return null;
}

function currentActivity() {
  try { return typeof appData !== 'undefined' ? appData?.latestActivity : null; } catch { return null; }
}

function activityStorageKey(activity) {
  return activity?.id ? `${COACH_ANALYSIS_PREFIX}${activity.id}` : null;
}

function storedActivityAnalysis(activity) {
  const key = activityStorageKey(activity);
  return key ? localStorage.getItem(key) : null;
}

function storeActivityAnalysis(activity, analysis) {
  const key = activityStorageKey(activity);
  if (key && analysis) localStorage.setItem(key, analysis);
}

function applyActivityPolish() {
  const activity = currentActivity();
  if (!activity) return;
  const maxHr = inferMaxHr(activity);
  if (maxHr && (!validBpm(activity.maxHr))) activity.maxHr = maxHr;

  const maxElement = document.querySelector('#activityMaxHr');
  if (maxElement) maxElement.textContent = maxHr ? `${maxHr} bpm` : '—';
  const avgElement = document.querySelector('#activityAvgHr');
  const avgHr = validBpm(activity.avgHr);
  if (avgElement) avgElement.textContent = avgHr ? `${avgHr} bpm` : '—';

  const threshold = document.querySelector('#progressThresholdHr');
  const thresholdUnit = threshold?.parentElement?.querySelector('em');
  const thresholdValue = validBpm(threshold?.textContent);
  if (thresholdUnit) thresholdUnit.style.display = thresholdValue ? '' : 'none';

  const saved = storedActivityAnalysis(activity);
  if (saved) {
    const detail = document.querySelector('#activityCoachAnalysis');
    const card = document.querySelector('#coachNote');
    if (detail) detail.innerHTML = coachStructuredHtml(saved);
    if (card) card.textContent = saved.replace(/\n+/g, ' ').slice(0, 240);
  } else {
    const raw = String(activity.coachNote || '');
    if (/\b(Conclusion|Key findings|Recommendation|This running|Heart rate averaged)\b/i.test(raw)) {
      const detail = document.querySelector('#activityCoachAnalysis');
      if (detail) detail.textContent = 'Analyse française en préparation…';
    }
  }
}

async function callCoachDirect(message) {
  const response = await fetch('/api/coach', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message })
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Coach indisponible');
  return String(body.reply || '').trim();
}

function appendCoachAutoMessage(text, label = 'Analyse automatique') {
  const thread = document.querySelector('#chatThread');
  if (!thread || !text) return;
  const bubble = document.createElement('div');
  bubble.className = 'bubble coach-bubble';
  bubble.innerHTML = `<span class="bubble-avatar">✦</span><div data-coach-structured="1"><div class="coach-auto-label">${coachEsc(label)}</div>${coachStructuredHtml(text)}</div>`;
  thread.appendChild(bubble);
  thread.scrollTop = thread.scrollHeight;
}

function activityAnalysisPrompt(activity, feedback = null) {
  const maxHr = inferMaxHr(activity);
  return `Analyse cette dernière activité COROS en français uniquement.
Données: date ${activity?.date || 'inconnue'}, sport ${activity?.sport || 'inconnu'}, distance ${activity?.distance || 'inconnue'}, durée ${activity?.duration || 'inconnue'}, allure ${activity?.pace || 'inconnue'}, FC moyenne ${validBpm(activity?.avgHr) || 'inconnue'} bpm, FC max ${maxHr || 'inconnue'} bpm, récupération du jour ${typeof appData !== 'undefined' ? appData?.metrics?.recovery ?? 'inconnue' : 'inconnue'}.
${feedback ? `Ressenti de l'athlète: RPE ${feedback.rpe}/10, jambes ${feedback.legs}, cardio ${feedback.cardio}, douleur ${feedback.pain}, aurait pu continuer ${feedback.couldContinue ? 'oui' : 'non'}, note ${feedback.note || 'aucune'}.` : ''}
Réponds avec exactement quatre sections courtes: Bilan de la séance, Ce que ça montre, Impact sur le plan, À surveiller. Pas d'anglais. Pas de tableau. Maximum 140 mots. Ne propose pas de diagnostic médical.`;
}

async function ensureFrenchActivityAnalysis({ force = false, feedback = null } = {}) {
  if (coachPolishBusy) return null;
  const activity = currentActivity();
  if (!activity?.id) return null;
  const existing = storedActivityAnalysis(activity);
  if (existing && !force) {
    applyActivityPolish();
    return existing;
  }
  coachPolishBusy = true;
  try {
    const analysis = await callCoachDirect(activityAnalysisPrompt(activity, feedback));
    if (analysis) {
      storeActivityAnalysis(activity, analysis);
      applyActivityPolish();
      return analysis;
    }
  } catch (error) {
    console.error('Analyse activité', error);
  } finally {
    coachPolishBusy = false;
  }
  return null;
}

function sleepMinutes(value) {
  const text = String(value || '');
  const hours = Number(text.match(/(\d+)\s*h/i)?.[1] || 0);
  const minutes = Number(text.match(/h\s*(\d{1,2})/)?.[1] || 0);
  return hours ? hours * 60 + minutes : null;
}

function weekStartIso(date = new Date()) {
  const paris = new Date(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date));
  const day = paris.getDay();
  const shift = day === 0 ? -6 : 1 - day;
  paris.setDate(paris.getDate() + shift);
  return `${paris.getFullYear()}-${String(paris.getMonth() + 1).padStart(2, '0')}-${String(paris.getDate()).padStart(2, '0')}`;
}

function parisWeekday() {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' }).formatToParts(new Date()).length &&
    new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' }).format(new Date()) === 'Sun' ? 0 :
    ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Paris', weekday: 'short' }).format(new Date())));
}

function weeklySignal(data) {
  const feedbacks = (data.feedback || []).slice(0, 10);
  if (feedbacks.some(item => item.pain && item.pain !== 'none')) return { reason: "J'ai une petite gêne", why: 'une gêne a été signalée cette semaine' };
  const recovery = Number(data.metrics?.recovery);
  const sleep = sleepMinutes(data.metrics?.sleepDuration);
  const ratio = Number(data.metrics?.loadRatio);
  if (Number.isFinite(recovery) && recovery < 55) return { reason: 'Je suis fatigué', why: 'la récupération est basse' };
  if (sleep && sleep < 360) return { reason: 'Je suis fatigué', why: 'le sommeil récent est insuffisant' };
  if (Number.isFinite(ratio) && ratio > 1.3) return { reason: "J'ai les jambes lourdes", why: 'la charge récente est élevée' };
  if (feedbacks.some(item => Number(item.rpe) >= 8 && item.couldContinue === false)) return { reason: 'Je suis fatigué', why: 'un feedback récent montre un effort difficile' };
  return null;
}

async function applyWeeklyPlanReview({ force = false } = {}) {
  const weekday = parisWeekday();
  if (!force && ![1, 2].includes(weekday)) return;
  const key = `${WEEKLY_REVIEW_PREFIX}${weekStartIso()}`;
  if (!force && localStorage.getItem(key)) return;
  try {
    let data = await (await fetch('/api/dashboard', { cache: 'no-store' })).json();
    const signal = weeklySignal(data);
    let changedSession = null;
    if (signal) {
      const sessions = (data.activePlan?.sessions || [])
        .filter(session => session.date >= data.meta.today && session.status !== 'completed')
        .sort((a, b) => a.date.localeCompare(b.date));
      const keySession = sessions.find(session => /blocs|seuil|allure|tempo|longue/i.test(session.title));
      if (keySession) {
        const proposalResponse = await fetch(`/api/sessions/${encodeURIComponent(keySession.id)}/adapt`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: signal.reason, note: `Revue hebdomadaire automatique : ${signal.why}.` })
        });
        const proposalBody = await proposalResponse.json();
        if (proposalResponse.ok && proposalBody.proposal?.id) {
          const applyResponse = await fetch(`/api/sessions/${encodeURIComponent(keySession.id)}/adapt/apply`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ proposalId: proposalBody.proposal.id })
          });
          if (applyResponse.ok) changedSession = proposalBody.proposal.proposed;
        }
      }
    }
    if (typeof safeReload === 'function') await safeReload();
    data = await (await fetch('/api/dashboard', { cache: 'no-store' })).json();
    const summary = await callCoachDirect(`Fais la revue de fin de semaine de mon plan. ${changedSession ? `Une adaptation automatique a été appliquée: ${changedSession.title}, ${changedSession.duration}.` : 'Aucune modification automatique n’a été nécessaire.'} Réponds en français avec quatre sections courtes: Revue hebdomadaire, Ce qui a bien fonctionné, Ajustement du plan, Priorité de la semaine. Maximum 130 mots.`);
    localStorage.setItem(key, JSON.stringify({ at: new Date().toISOString(), changed: Boolean(changedSession), summary }));
    appendCoachAutoMessage(summary, 'Revue hebdomadaire');
  } catch (error) {
    console.error('Revue hebdomadaire', error);
  }
}

async function interceptFeedbackSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement) || form.id !== 'feedbackForm') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!form.reportValidity()) return;
  const values = Object.fromEntries(new FormData(form).entries());
  const feedbackState = typeof runtimeFeedbackState !== 'undefined' ? runtimeFeedbackState : { activityId: null, sessionId: null };
  const payload = {
    ...values,
    rpe: Number(values.rpe),
    couldContinue: values.couldContinue === 'yes',
    activityId: feedbackState.activityId,
    sessionId: feedbackState.sessionId
  };
  const status = form.querySelector('#feedbackStatus');
  if (status) status.textContent = 'Enregistrement et analyse…';
  try {
    const response = await fetch('/api/feedback', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Impossible d’enregistrer le ressenti');
    if (typeof safeReload === 'function') await safeReload();
    let analysis = null;
    if (payload.activityId) analysis = await ensureFrenchActivityAnalysis({ force: true, feedback: payload });
    if (status) status.textContent = analysis ? 'Ressenti enregistré · analyse terminée ✓' : 'Ressenti enregistré ✓';
    setTimeout(() => form.closest('dialog')?.close(), 350);
    if (analysis) {
      if (typeof setScreen === 'function') setScreen('coach');
      appendCoachAutoMessage(analysis, 'Analyse après ressenti');
    }
    const weekday = parisWeekday();
    if (weekday === 0) await applyWeeklyPlanReview({ force: true });
  } catch (error) {
    console.error(error);
    if (status) status.textContent = error.message || 'Erreur';
  }
}

function initCoachPolish() {
  injectCoachPolishStyles();
  polishCoachBubbles();
  applyActivityPolish();
  const thread = document.querySelector('#chatThread');
  if (thread) new MutationObserver(() => polishCoachBubbles(thread)).observe(thread, { childList: true, subtree: true });
  document.addEventListener('submit', interceptFeedbackSubmit, true);
  document.addEventListener('click', event => {
    if (event.target.closest('#viewActivityButton,#activityDetail .more-button')) setTimeout(applyActivityPolish, 0);
  });
  setTimeout(() => ensureFrenchActivityAnalysis(), 1000);
  setTimeout(() => applyWeeklyPlanReview(), 1800);
  window.addEventListener('pageshow', () => {
    setTimeout(applyActivityPolish, 0);
    setTimeout(() => ensureFrenchActivityAnalysis(), 500);
    setTimeout(() => applyWeeklyPlanReview(), 1200);
  });
}

initCoachPolish();
