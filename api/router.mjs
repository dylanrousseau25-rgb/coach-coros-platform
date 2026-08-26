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
      persistence: 'temporary-vercel-demo'
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
  const { activeObjective, activePlan, todaySession, latestActivity } = activeContext(state);
  if (!process.env.OPENAI_API_KEY) {
    return `Mode démo : j'ai reçu « ${userMessage} ». Ton objectif actif est « ${activeObjective?.title || 'aucun objectif actif'} ». Ajoute OPENAI_API_KEY dans Vercel pour activer le coach IA.`;
  }

  const context = {
    athlete: state.athlete,
    heartRateZones: state.heartRateZones,
    metrics: state.metrics,
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
      input: `Tu es Coach COROS, coach d'endurance prudent dans une application multi-objectifs.\nContexte JSON:\n${JSON.stringify(context)}\nMessage de l'athlète: ${userMessage}\nRéponds en français, de façon concise et pratique. La fréquence cardiaque COROS est prioritaire pour les séances faciles. Prévention des blessures avant la performance.`
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

      if (method === 'GET' && route === 'dashboard') return json(dashboard(state));
      if (method === 'GET' && route === 'coros/status') {
        return json({
          mode: process.env.COROS_MODE || 'demo',
          connected: Boolean(process.env.COROS_ACCESS_TOKEN),
          note: 'Déploiement de test Vercel : la persistance est temporaire tant qu’une vraie base de données n’est pas branchée.'
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
          title: payload.title.trim(),
          sport: payload.sport.trim(),
          type: payload.type?.trim() || 'Objectif',
          eventName: payload.eventName?.trim() || '',
          date: payload.date || null,
          target: payload.target?.trim() || '',
          targetPace: payload.targetPace?.trim() || '',
          sessionsPerWeek: payload.sessionsPerWeek ? Number(payload.sessionsPerWeek) : null,
          status: 'planned',
          planId: plan.id,
          createdAt: new Date().toISOString()
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

      if (method === 'POST' && route === 'feedback') {
        const payload = await request.json();
        for (const key of ['rpe','legs','cardio','pain','couldContinue']) {
          if (payload[key] === undefined || payload[key] === '') return json({ error: `Champ manquant: ${key}` }, 400);
        }
        const { activeObjective, activePlan, latestActivity } = activeContext(state);
        if (!latestActivity) return json({ error: 'Aucune activité à commenter' }, 400);
        const item = { id:crypto.randomUUID(), at:new Date().toISOString(), activityId:latestActivity.id, objectiveId:activeObjective?.id || null, planId:activePlan?.id || null, ...payload };
        state.feedback.unshift(item);
        await saveState(state);
        return json({ ok:true, feedback:item }, 201);
      }

      if (method === 'POST' && route === 'coach') {
        const { message } = await request.json();
        if (!message?.trim()) return json({ error: 'Message vide' }, 400);
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
