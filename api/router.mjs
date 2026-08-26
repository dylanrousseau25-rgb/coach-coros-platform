import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';

const bundledState = new URL('../data/state.json', import.meta.url);
const tmpState = path.join(os.tmpdir(), 'coach-coros-state.json');

async function readState() {
  try {
    return JSON.parse(await readFile(tmpState, 'utf8'));
  } catch {
    const initial = JSON.parse(await readFile(bundledState, 'utf8'));
    await writeFile(tmpState, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
}

async function saveState(state) {
  await writeFile(tmpState, JSON.stringify(state, null, 2), 'utf8');
}

function localDateIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function daysToDate(date) {
  if (!date) return null;
  const today = new Date(`${localDateIso()}T00:00:00Z`);
  const target = new Date(`${date}T00:00:00Z`);
  return Math.max(0, Math.ceil((target - today) / 86400000));
}

function addDaysIso(dateIso, days) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dayLabel(dateIso) {
  return ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'][new Date(`${dateIso}T12:00:00Z`).getUTCDay()];
}

function sessionTemplateForDate(dateIso, plan) {
  const weekday = new Date(`${dateIso}T12:00:00Z`).getUTCDay();
  const start = new Date(`${plan.startDate || dateIso}T12:00:00Z`);
  const current = new Date(`${dateIso}T12:00:00Z`);
  const weekIndex = Math.max(0, Math.floor((current - start) / (7 * 86400000)));
  const longMinutes = Math.min(95, 60 + weekIndex * 5);
  const easyMinutes = Math.min(55, 40 + weekIndex * 3);

  const base = {
    id: `sess-${dateIso.replaceAll('-', '')}`,
    date: dateIso,
    day: dayLabel(dateIso),
    status: 'planned',
    generatedBy: 'adaptive-plan-v1'
  };

  if (weekday === 1) return { ...base, sport: 'Repos', title: 'Repos / mobilité', duration: '20 min optionnel', details: 'Mobilité douce uniquement si utile. L’objectif est d’absorber la charge du week-end.', zone: 1, zoneLabel: 'Repos', hrTarget: '—', rpeTarget: '1/10', paceTarget: '—' };
  if (weekday === 2) return { ...base, sport: 'Course à pied', title: 'Blocs allure 20 km', duration: '≈ 60 min', details: '15 min facile + 4×5 min à 6:00–6:10/km, récup 3 min + 10 min facile. Reste contrôlé.', zone: 3, zoneLabel: 'Z3 → Z4', hrTarget: '152–171 bpm', rpeTarget: '5–6/10', paceTarget: '6:00–6:10 /km' };
  if (weekday === 3) return { ...base, sport: 'Gravel / vélo', title: 'Récupération active', duration: '40–50 min', details: 'Très facile. Reste en Z1 autant que possible et transforme en repos si les jambes sont lourdes.', zone: 1, zoneLabel: 'Z1', hrTarget: '< 134 bpm', rpeTarget: '1–2/10', paceTarget: 'FC prioritaire' };
  if (weekday === 4) return { ...base, sport: 'Course à pied', title: 'Endurance fondamentale', duration: `${easyMinutes}–${easyMinutes + 5} min`, details: 'Conversation fluide. Ralentis ou marche brièvement si la FC reste au-dessus de 151 bpm.', zone: 2, zoneLabel: 'Z2', hrTarget: '134–151 bpm', rpeTarget: '2–3/10', paceTarget: 'Libre' };
  if (weekday === 5) return { ...base, sport: 'Vélo + renfo', title: 'Endurance facile + renfo', duration: '60–75 min + 10 min', details: 'Endurance facile puis renforcement léger sans douleur. Pas de squat forcé en cas de gêne.', zone: 1, zoneLabel: 'Z1 → bas Z2', hrTarget: '< 151 bpm', rpeTarget: '2–3/10', paceTarget: '—' };
  if (weekday === 6) return { ...base, sport: 'Course à pied', title: 'Sortie longue facile', duration: `${longMinutes}–${longMinutes + 5} min`, details: 'Reste patient en Z2. L’objectif est le temps passé en endurance, pas l’allure.', zone: 2, zoneLabel: 'Z2', hrTarget: '134–151 bpm', rpeTarget: '2–3/10', paceTarget: 'Libre' };
  return { ...base, sport: 'Gravel', title: 'Endurance aérobie', duration: '1 h 30–2 h', details: 'Volume sans impact à intensité facile. Hydratation et alimentation régulières.', zone: 2, zoneLabel: 'Z2', hrTarget: '134–151 bpm', rpeTarget: '2–3/10', paceTarget: '—' };
}

function ensurePlanCoverage(state, horizonDays = 14) {
  const activeObjective = state.objectives?.find(item => item.status === 'active');
  const plan = activeObjective
    ? state.plans?.find(item => item.id === activeObjective.planId)
    : state.plans?.find(item => item.status === 'active');
  if (!plan) return false;

  plan.sessions ||= [];
  const today = localDateIso();
  const horizon = addDaysIso(today, horizonDays);
  const end = activeObjective?.date && activeObjective.date < horizon ? activeObjective.date : horizon;
  const existingDates = new Set(plan.sessions.map(item => item.date).filter(Boolean));
  let changed = false;

  for (let date = today; date <= end; date = addDaysIso(date, 1)) {
    if (existingDates.has(date)) continue;
    plan.sessions.push(sessionTemplateForDate(date, plan));
    existingDates.add(date);
    changed = true;
  }

  plan.sessions.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  if (plan.startDate) {
    const start = new Date(`${plan.startDate}T12:00:00Z`);
    const now = new Date(`${today}T12:00:00Z`);
    const computedWeek = Math.max(1, Math.floor((now - start) / (7 * 86400000)) + 1);
    if (plan.currentWeek !== computedWeek) {
      plan.currentWeek = computedWeek;
      changed = true;
    }
    const nextPhase = computedWeek <= 2 ? 'Reprise & base' : computedWeek <= 5 ? 'Développement spécifique' : 'Spécifique 20 km';
    if (plan.phase !== nextPhase) {
      plan.phase = nextPhase;
      changed = true;
    }
  }
  return changed;
}

function activeContext(state) {
  const activeObjective = state.objectives.find(o => o.status === 'active') || null;
  const activePlan = activeObjective
    ? state.plans.find(p => p.id === activeObjective.planId) || null
    : state.plans.find(p => p.status === 'active') || null;
  const todayIso = localDateIso();
  const todaySession = activePlan?.sessions?.find(s => s.date === todayIso) || null;
  const latestActivity = [...(state.activities || [])].sort((a,b) => b.date.localeCompare(a.date))[0] || null;
  return { activeObjective, activePlan, todaySession, latestActivity, todayIso };
}

function findSession(state, id) {
  for (const plan of state.plans || []) {
    const session = (plan.sessions || []).find(item => item.id === id);
    if (session) return { plan, session };
  }
  return null;
}

function adaptationFor(session, reason, note = '') {
  const signal = `${reason || ''} ${note || ''}`.toLowerCase();
  const proposed = { ...session };
  delete proposed.completedAt;
  proposed.status = 'planned';

  let explanation = 'On garde l’objectif de la séance mais on réduit le coût de fatigue.';
  if (/gêne|douleur|pain|bless/.test(signal)) {
    Object.assign(proposed, {
      sport: 'Repos actif / mobilité', title: 'Récupération sans impact', duration: '20–30 min',
      details: 'Mobilité douce ou marche uniquement si la gêne reste légère. Arrête si la douleur augmente.',
      zone: 1, zoneLabel: 'Très facile', hrTarget: '—', rpeTarget: '1–2/10', paceTarget: '—'
    });
    explanation = 'Une gêne prime sur la performance : on retire l’impact et l’intensité aujourd’hui.';
  } else if (/peu de temps|temps|court|30 min|press/.test(signal)) {
    proposed.duration = '30 min';
    proposed.details = /blocs|allure|seuil/i.test(session.title)
      ? '10 min facile + 2×5 min à l’allure cible, récup 3 min + retour au calme.'
      : '5 min très facile + 20 min dans la zone cible + 5 min de retour au calme.';
    explanation = 'On conserve le stimulus principal en compressant la séance à 30 minutes.';
  } else if (/jambes lourdes|lourdes|courbature/.test(signal)) {
    Object.assign(proposed, {
      sport: 'Gravel / vélo', title: 'Décrassage jambes lourdes', duration: '35–45 min',
      details: 'Pédalage très souple, sans force. Reste en Z1 et écourte si les jambes ne se libèrent pas.',
      zone: 1, zoneLabel: 'Z1', hrTarget: '< 134 bpm', rpeTarget: '1–2/10', paceTarget: 'FC prioritaire'
    });
    explanation = 'On remplace l’impact par du mouvement facile pour favoriser la récupération.';
  } else if (/fatigu|sommeil|épuis|crevé/.test(signal)) {
    Object.assign(proposed, {
      sport: 'Gravel / vélo', title: 'Récupération active', duration: '30–40 min',
      details: 'Très facile en Z1. Si la fatigue est générale ou inhabituelle, transforme simplement en repos.',
      zone: 1, zoneLabel: 'Z1', hrTarget: '< 134 bpm', rpeTarget: '1–2/10', paceTarget: 'FC prioritaire'
    });
    explanation = 'La fatigue du jour justifie de réduire nettement la charge sans casser la continuité.';
  } else if (/très bien|super|forme|excellent/.test(signal)) {
    proposed.details = `${session.details || ''} Si les sensations restent excellentes, ajoute seulement 5–10 min très faciles à la fin.`.trim();
    explanation = 'Même avec de très bonnes sensations, on ne transforme pas une bonne journée en surcharge : la séance reste maîtrisée.';
  }

  return { proposed, explanation };
}

function dashboard(state) {
  const ctx = activeContext(state);
  return {
    ...state,
    activeObjective: ctx.activeObjective,
    activePlan: ctx.activePlan,
    todaySession: ctx.todaySession,
    latestActivity: ctx.latestActivity,
    meta: {
      today: ctx.todayIso,
      daysToObjective: daysToDate(ctx.activeObjective?.date),
      corosMode: process.env.COROS_MODE || 'demo',
      openAiMode: process.env.OPENAI_API_KEY ? 'connected' : 'demo',
      persistence: 'temporary-vercel-demo',
      adaptivePlan: true
    }
  };
}

function objectivePlanTemplate(objectiveId, title, date) {
  return {
    id: `plan-${crypto.randomUUID()}`,
    objectiveId,
    name: `Plan · ${title}`,
    status: 'draft',
    startDate: localDateIso(),
    endDate: date || null,
    totalWeeks: null,
    currentWeek: 0,
    phase: 'À construire',
    principle: "Le coach doit analyser l'historique et construire ce plan avec l'athlète.",
    sessions: []
  };
}

async function coachReply(state, userMessage) {
  ensurePlanCoverage(state);
  const { activeObjective, activePlan, todaySession, latestActivity, todayIso } = activeContext(state);
  if (!process.env.OPENAI_API_KEY) {
    return `Mode démo : j'ai reçu « ${userMessage} ». Ton objectif actif est « ${activeObjective?.title || 'aucun objectif actif'} ». Ajoute OPENAI_API_KEY dans Vercel pour activer le coach IA.`;
  }

  const corosLive = (process.env.COROS_MODE || 'demo') !== 'demo';
  const context = {
    athlete: state.athlete,
    heartRateZones: state.heartRateZones,
    metrics: corosLive ? state.metrics : null,
    dataFreshness: {
      today: todayIso,
      corosLive,
      note: corosLive
        ? 'Les métriques COROS peuvent être utilisées comme état du jour.'
        : "COROS n'est pas synchronisé : ne pas utiliser les anciennes métriques de démonstration comme état actuel."
    },
    activeObjective,
    activePlan,
    todaySession,
    latestActivity,
    recentFeedback: (state.feedback || []).slice(0, 8)
  };

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-terra',
      reasoning: { effort: 'low' },
      input: `Tu es Coach COROS, coach d'endurance prudent dans une application multi-objectifs.\nContexte JSON:\n${JSON.stringify(context)}\nMessage de l'athlète: ${userMessage}\nRéponds en français, de façon concise et pratique. La fréquence cardiaque COROS est prioritaire pour les séances faciles. Prévention des blessures avant la performance. Si dataFreshness.corosLive est faux, ne présente jamais récupération, sommeil ou charge de démonstration comme des données actuelles : indique que l'état physiologique du jour n'est pas synchronisé et appuie-toi sur les sensations fournies par l'athlète.`
    })
  });
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  const data = await response.json();
  return (data.output || []).flatMap(i => i.content || []).filter(i => i.type === 'output_text').map(i => i.text).join('\n').trim() || 'Pas de réponse.';
}

function json(body, status=200) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const route = url.searchParams.get('path') || '';
      const method = request.method.toUpperCase();
      const state = await readState();

      if (method === 'GET' && route === 'dashboard') {
        if (ensurePlanCoverage(state)) await saveState(state);
        return json(dashboard(state));
      }
      if (method === 'GET' && route === 'coros/status') {
        return json({
          mode: process.env.COROS_MODE || 'demo',
          connected: Boolean(process.env.COROS_ACCESS_TOKEN),
          note: 'Les métriques sont masquées dans l’app tant qu’une vraie synchronisation COROS n’est pas active.'
        });
      }

      if (method === 'POST' && route === 'objectives') {
        const payload = await request.json();
        if (!payload.title?.trim()) return json({ error: "Nom de l'objectif requis" }, 400);
        if (!payload.sport?.trim()) return json({ error: 'Sport requis' }, 400);
        const objectiveId = `obj-${crypto.randomUUID()}`;
        const plan = objectivePlanTemplate(objectiveId, payload.title.trim(), payload.date || null);
        const objective = {
          id: objectiveId,
          title: payload.title.trim(), sport: payload.sport.trim(), type: payload.type?.trim() || 'Objectif',
          eventName: payload.eventName?.trim() || '', date: payload.date || null, target: payload.target?.trim() || '',
          targetPace: payload.targetPace?.trim() || '', sessionsPerWeek: payload.sessionsPerWeek ? Number(payload.sessionsPerWeek) : null,
          status: 'planned', planId: plan.id, createdAt: new Date().toISOString()
        };
        state.objectives.unshift(objective);
        state.plans.unshift(plan);
        await saveState(state);
        return json({ ok:true, objective, plan }, 201);
      }

      let match = route.match(/^objectives\/([^/]+)\/activate$/);
      if (method === 'POST' && match) {
        const id = decodeURIComponent(match[1]);
        const objective = state.objectives.find(o => o.id === id);
        if (!objective) return json({ error: 'Objectif introuvable' }, 404);
        for (const o of state.objectives) if (o.status === 'active') o.status = 'planned';
        for (const p of state.plans) if (p.status === 'active') p.status = 'paused';
        objective.status = 'active';
        const plan = state.plans.find(p => p.id === objective.planId);
        if (plan) plan.status = 'active';
        ensurePlanCoverage(state);
        await saveState(state);
        return json({ ok:true, activeObjective: objective, activePlan: plan || null });
      }

      match = route.match(/^objectives\/([^/]+)\/complete$/);
      if (method === 'POST' && match) {
        const id = decodeURIComponent(match[1]);
        const objective = state.objectives.find(o => o.id === id);
        if (!objective) return json({ error: 'Objectif introuvable' }, 404);
        objective.status = 'completed';
        objective.completedAt = new Date().toISOString();
        const plan = state.plans.find(p => p.id === objective.planId);
        if (plan) plan.status = 'completed';
        await saveState(state);
        return json({ ok:true, objective });
      }

      match = route.match(/^sessions\/([^/]+)\/complete$/);
      if (method === 'POST' && match) {
        const id = decodeURIComponent(match[1]);
        const found = findSession(state, id);
        if (!found) return json({ error: 'Séance introuvable' }, 404);
        found.session.status = 'completed';
        found.session.completedAt = new Date().toISOString();
        await saveState(state);
        return json({ ok:true, session:found.session });
      }

      match = route.match(/^sessions\/([^/]+)\/adapt$/);
      if (method === 'POST' && match) {
        const id = decodeURIComponent(match[1]);
        const found = findSession(state, id);
        if (!found) return json({ error: 'Séance introuvable' }, 404);
        if (found.session.status === 'completed') return json({ error: 'Une séance terminée ne peut plus être adaptée.' }, 409);
        const payload = await request.json();
        const { proposed, explanation } = adaptationFor(found.session, payload.reason, payload.note);
        const proposal = {
          id: crypto.randomUUID(),
          sessionId: found.session.id,
          createdAt: new Date().toISOString(),
          status: 'proposed',
          reason: explanation,
          userReason: payload.reason || '',
          note: payload.note || '',
          original: {
            title: found.session.title, sport: found.session.sport, duration: found.session.duration,
            hrTarget: found.session.hrTarget, rpeTarget: found.session.rpeTarget
          },
          proposed: {
            title: proposed.title, sport: proposed.sport, duration: proposed.duration, details: proposed.details,
            zone: proposed.zone, zoneLabel: proposed.zoneLabel, hrTarget: proposed.hrTarget,
            rpeTarget: proposed.rpeTarget, paceTarget: proposed.paceTarget
          }
        };
        state.adaptationProposals ||= [];
        state.adaptationProposals.unshift(proposal);
        await saveState(state);
        return json({ ok:true, proposal });
      }

      match = route.match(/^sessions\/([^/]+)\/adapt\/apply$/);
      if (method === 'POST' && match) {
        const id = decodeURIComponent(match[1]);
        const found = findSession(state, id);
        if (!found) return json({ error: 'Séance introuvable' }, 404);
        const payload = await request.json();
        const proposal = (state.adaptationProposals || []).find(item => item.id === payload.proposalId && item.sessionId === id);
        if (!proposal) return json({ error: 'Proposition introuvable' }, 404);
        if (proposal.status !== 'proposed') return json({ error: 'Cette proposition a déjà été traitée.' }, 409);
        const originalSnapshot = { ...found.session };
        Object.assign(found.session, proposal.proposed, {
          adaptedAt: new Date().toISOString(),
          adaptedFrom: originalSnapshot,
          adaptationReason: proposal.userReason || proposal.reason
        });
        proposal.status = 'applied';
        proposal.appliedAt = new Date().toISOString();
        await saveState(state);
        return json({ ok:true, session:found.session, proposal });
      }

      if (method === 'POST' && route === 'feedback') {
        const payload = await request.json();
        for (const key of ['rpe','legs','cardio','pain','couldContinue']) {
          if (payload[key] === undefined || payload[key] === '') return json({ error: `Champ manquant: ${key}` }, 400);
        }
        const { activeObjective, activePlan, latestActivity } = activeContext(state);
        const activityId = payload.activityId || latestActivity?.id || null;
        const sessionId = payload.sessionId || null;
        if (!activityId && !sessionId) return json({ error: 'Aucune activité ou séance à commenter' }, 400);
        const item = {
          id:crypto.randomUUID(), at:new Date().toISOString(), activityId, sessionId,
          objectiveId:activeObjective?.id || null, planId:activePlan?.id || null, ...payload
        };
        state.feedback.unshift(item);
        await saveState(state);
        return json({ ok:true, feedback:item }, 201);
      }

      if (method === 'POST' && route === 'coach') {
        const { message } = await request.json();
        if (!message?.trim()) return json({ error: 'Message vide' }, 400);
        ensurePlanCoverage(state);
        const reply = await coachReply(state, message.trim());
        state.coachMessages.unshift({ at:new Date().toISOString(), text:reply });
        await saveState(state);
        return json({ reply });
      }

      return json({ error: `Route API inconnue: ${route}` }, 404);
    } catch (error) {
      return json({ error: error?.message || 'Erreur serveur' }, 500);
    }
  }
};
