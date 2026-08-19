import http from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const stateFile = path.join(__dirname, "data", "state.json");
const port = Number(process.env.PORT || 8787);

const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json"
};

async function readState() {
  return JSON.parse(await readFile(stateFile, "utf8"));
}

async function saveState(state) {
  await writeFile(stateFile, JSON.stringify(state, null, 2) + "\n", "utf8");
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function localDateIso() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.APP_TIMEZONE || "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return formatter.format(new Date());
}

function daysToDate(date) {
  if (!date) return null;
  const today = new Date(`${localDateIso()}T00:00:00Z`);
  const target = new Date(`${date}T00:00:00Z`);
  return Math.max(0, Math.ceil((target - today) / 86400000));
}

function activeContext(state) {
  const activeObjective = state.objectives.find(o => o.status === "active") || null;
  const activePlan = activeObjective
    ? state.plans.find(p => p.id === activeObjective.planId) || null
    : state.plans.find(p => p.status === "active") || null;
  const todayIso = localDateIso();
  const todaySession = activePlan?.sessions?.find(s => s.date === todayIso)
    || activePlan?.sessions?.find(s => s.status === "today")
    || null;
  const latestActivity = [...(state.activities || [])].sort((a, b) => b.date.localeCompare(a.date))[0] || null;
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
      corosMode: process.env.COROS_MODE || "demo",
      openAiMode: process.env.OPENAI_API_KEY ? "connected" : "demo"
    }
  };
}

async function coachReply(state, userMessage) {
  const { activeObjective, activePlan, todaySession, latestActivity } = activeContext(state);
  if (!process.env.OPENAI_API_KEY) {
    const goal = activeObjective?.title || "aucun objectif actif";
    return `Mode démo : j'ai reçu « ${userMessage} ». Ton objectif actif est « ${goal} ». Le coach utiliserait le plan actif, tes zones COROS, ta récupération (${state.metrics.recovery} %) et ton dernier feedback pour proposer l'adaptation. Ajoute OPENAI_API_KEY pour activer le coach IA.`;
  }

  const coachContext = {
    athlete: state.athlete,
    heartRateZones: state.heartRateZones,
    metrics: state.metrics,
    activeObjective,
    activePlan,
    todaySession,
    latestActivity,
    recentFeedback: (state.feedback || []).slice(0, 8),
    recentCoachMessages: (state.coachMessages || []).slice(0, 8)
  };

  const prompt = `Tu es Coach COROS, coach d'endurance prudent dans une application multi-objectifs.\n\nContexte JSON:\n${JSON.stringify(coachContext)}\n\nMessage de l'athlète: ${userMessage}\n\nRéponds en français, de façon concise et pratique. Utilise l'objectif actif seulement s'il existe. La fréquence cardiaque COROS est prioritaire pour les séances faciles. Prévention des blessures avant la performance. Ne prétends jamais avoir modifié COROS ou le plan si aucune action explicite ne l'a fait.`;

  const apiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-terra",
      reasoning: { effort: "low" },
      input: prompt
    })
  });

  if (!apiResponse.ok) throw new Error(`OpenAI API ${apiResponse.status}: ${await apiResponse.text()}`);
  const response = await apiResponse.json();
  const text = (response.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === "output_text")
    .map(item => item.text)
    .join("\n")
    .trim();
  return text || "Le coach n'a pas renvoyé de texte.";
}

function objectivePlanTemplate(objectiveId, title, date) {
  return {
    id: `plan-${crypto.randomUUID()}`,
    objectiveId,
    name: `Plan · ${title}`,
    status: "draft",
    startDate: localDateIso(),
    endDate: date || null,
    totalWeeks: null,
    currentWeek: 0,
    phase: "À construire",
    principle: "Le coach doit analyser l'historique et construire ce plan avec l'athlète.",
    sessions: []
  };
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/dashboard") {
    return json(res, 200, dashboard(await readState()));
  }

  if (req.method === "GET" && url.pathname === "/api/coros/status") {
    return json(res, 200, {
      mode: process.env.COROS_MODE || "demo",
      connected: Boolean(process.env.COROS_ACCESS_TOKEN),
      note: process.env.COROS_ACCESS_TOKEN
        ? "Un accès COROS externe est configuré."
        : "Mode démo : les données COROS du prototype sont stockées localement."
    });
  }

  if (req.method === "POST" && url.pathname === "/api/objectives") {
    const payload = await bodyJson(req);
    if (!payload.title?.trim()) return json(res, 400, { error: "Nom de l'objectif requis" });
    if (!payload.sport?.trim()) return json(res, 400, { error: "Sport requis" });

    const state = await readState();
    const objectiveId = `obj-${crypto.randomUUID()}`;
    const plan = objectivePlanTemplate(objectiveId, payload.title.trim(), payload.date || null);
    const objective = {
      id: objectiveId,
      title: payload.title.trim(),
      sport: payload.sport.trim(),
      type: payload.type?.trim() || "Objectif",
      eventName: payload.eventName?.trim() || "",
      date: payload.date || null,
      target: payload.target?.trim() || "",
      targetPace: payload.targetPace?.trim() || "",
      sessionsPerWeek: payload.sessionsPerWeek ? Number(payload.sessionsPerWeek) : null,
      status: "planned",
      planId: plan.id,
      createdAt: new Date().toISOString()
    };
    state.objectives.unshift(objective);
    state.plans.unshift(plan);
    await saveState(state);
    return json(res, 201, { ok: true, objective, plan });
  }

  const activateMatch = url.pathname.match(/^\/api\/objectives\/([^/]+)\/activate$/);
  if (req.method === "POST" && activateMatch) {
    const id = decodeURIComponent(activateMatch[1]);
    const state = await readState();
    const objective = state.objectives.find(o => o.id === id);
    if (!objective) return json(res, 404, { error: "Objectif introuvable" });

    for (const o of state.objectives) {
      if (o.status === "active") o.status = "planned";
    }
    for (const p of state.plans) {
      if (p.status === "active") p.status = "paused";
    }
    objective.status = "active";
    const plan = state.plans.find(p => p.id === objective.planId);
    if (plan) plan.status = "active";
    await saveState(state);
    return json(res, 200, { ok: true, activeObjective: objective, activePlan: plan || null });
  }

  const completeMatch = url.pathname.match(/^\/api\/objectives\/([^/]+)\/complete$/);
  if (req.method === "POST" && completeMatch) {
    const id = decodeURIComponent(completeMatch[1]);
    const state = await readState();
    const objective = state.objectives.find(o => o.id === id);
    if (!objective) return json(res, 404, { error: "Objectif introuvable" });
    objective.status = "completed";
    objective.completedAt = new Date().toISOString();
    const plan = state.plans.find(p => p.id === objective.planId);
    if (plan) plan.status = "completed";
    await saveState(state);
    return json(res, 200, { ok: true, objective });
  }

  if (req.method === "POST" && url.pathname === "/api/feedback") {
    const payload = await bodyJson(req);
    const required = ["rpe", "legs", "cardio", "pain", "couldContinue"];
    for (const key of required) {
      if (payload[key] === undefined || payload[key] === "") return json(res, 400, { error: `Champ manquant: ${key}` });
    }
    const state = await readState();
    const { activeObjective, activePlan, latestActivity } = activeContext(state);
    if (!latestActivity) return json(res, 400, { error: "Aucune activité à commenter" });
    const item = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      activityId: latestActivity.id,
      objectiveId: activeObjective?.id || null,
      planId: activePlan?.id || null,
      ...payload
    };
    state.feedback.unshift(item);
    await saveState(state);
    return json(res, 201, { ok: true, feedback: item });
  }

  if (req.method === "POST" && url.pathname === "/api/coach") {
    const { message } = await bodyJson(req);
    if (!message?.trim()) return json(res, 400, { error: "Message vide" });
    const state = await readState();
    const reply = await coachReply(state, message.trim());
    state.coachMessages.unshift({ at: new Date().toISOString(), text: reply });
    await saveState(state);
    return json(res, 200, { reply });
  }

  return false;
}

async function serveStatic(res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const safePath = path.normalize(requested).replace(/^(\.\.(\/|\\|$))+/, "");
  let filePath = path.join(publicDir, safePath);
  if (!filePath.startsWith(publicDir)) return false;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, "index.html");
    const data = await readFile(filePath);
    res.writeHead(200, { "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(req, res, url);
      if (handled !== false) return;
      return json(res, 404, { error: "Route API introuvable" });
    }
    if (await serveStatic(res, url.pathname)) return;
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
  } catch (error) {
    console.error(error);
    json(res, 500, { error: "Erreur serveur", detail: error.message });
  }
});

server.listen(port, () => {
  console.log(`Coach COROS Platform → http://localhost:${port}`);
});
