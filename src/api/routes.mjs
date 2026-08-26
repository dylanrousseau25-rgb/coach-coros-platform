import { db, withTransaction } from '../db/pool.mjs';
import { readJson, json } from '../http.mjs';
import { dashboardForUser } from '../dashboard/repository.mjs';
import { providerStatus, disconnectProvider } from '../providers/repository.mjs';

function clean(value, max = 255) {
  return String(value ?? '').trim().slice(0, max);
}

async function createObjective(req, res, user) {
  const payload = await readJson(req);
  const title = clean(payload.title);
  const sport = clean(payload.sport, 100);
  if (!title) return json(res, 400, { error: "Nom de l'objectif requis." });
  if (!sport) return json(res, 400, { error: 'Sport requis.' });

  const result = await withTransaction(async connection => {
    const [objectiveResult] = await connection.execute(
      `INSERT INTO objectives
        (user_id, title, sport, objective_type, event_name, event_date,
         target, target_pace, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'planned')`,
      [
        user.id,
        title,
        sport,
        clean(payload.type || 'Objectif', 100) || 'Objectif',
        clean(payload.eventName),
        payload.date || null,
        clean(payload.target),
        clean(payload.targetPace, 100)
      ]
    );

    const [planResult] = await connection.execute(
      `INSERT INTO training_plans
        (user_id, objective_id, name, status, phase, start_date, end_date, current_week, principle)
       VALUES (?, ?, ?, 'draft', 'À construire', CURRENT_DATE(), ?, 0, ?)`,
      [
        user.id,
        objectiveResult.insertId,
        `Plan · ${title}`,
        payload.date || null,
        "Le coach doit analyser l'historique et construire ce plan avec l'athlète."
      ]
    );

    return { objectiveId: objectiveResult.insertId, planId: planResult.insertId };
  });

  return json(res, 201, { ok: true, ...result });
}

async function activateObjective(res, user, objectiveId) {
  const id = Number(objectiveId);
  if (!Number.isSafeInteger(id) || id <= 0) return json(res, 400, { error: 'Objectif invalide.' });

  const result = await withTransaction(async connection => {
    const [rows] = await connection.execute(
      'SELECT id FROM objectives WHERE id = ? AND user_id = ? LIMIT 1 FOR UPDATE',
      [id, user.id]
    );
    if (!rows.length) return null;

    await connection.execute(
      `UPDATE objectives SET status = 'planned'
       WHERE user_id = ? AND status = 'active' AND id <> ?`,
      [user.id, id]
    );
    await connection.execute(
      `UPDATE training_plans SET status = 'paused'
       WHERE user_id = ? AND status = 'active' AND objective_id <> ?`,
      [user.id, id]
    );
    await connection.execute(
      `UPDATE objectives SET status = 'active' WHERE id = ? AND user_id = ?`,
      [id, user.id]
    );
    await connection.execute(
      `UPDATE training_plans SET status = 'active'
       WHERE user_id = ? AND objective_id = ?
       ORDER BY id DESC LIMIT 1`,
      [user.id, id]
    );
    return true;
  });

  if (!result) return json(res, 404, { error: 'Objectif introuvable.' });
  return json(res, 200, { ok: true });
}

async function completeSession(res, user, sessionId) {
  const id = Number(sessionId);
  if (!Number.isSafeInteger(id) || id <= 0) return json(res, 400, { error: 'Séance invalide.' });
  const [result] = await db().execute(
    `UPDATE plan_sessions ps
     JOIN training_plans tp ON tp.id = ps.plan_id AND tp.user_id = ?
     SET ps.status = 'completed'
     WHERE ps.id = ? AND ps.user_id = ?`,
    [user.id, id, user.id]
  );
  if (!result.affectedRows) return json(res, 404, { error: 'Séance introuvable.' });
  return json(res, 200, { ok: true });
}

async function saveFeedback(req, res, user, activityId) {
  const id = Number(activityId);
  if (!Number.isSafeInteger(id) || id <= 0) return json(res, 400, { error: 'Activité invalide.' });
  const payload = await readJson(req);

  const [activities] = await db().execute(
    'SELECT id FROM activities WHERE id = ? AND user_id = ? LIMIT 1',
    [id, user.id]
  );
  if (!activities.length) return json(res, 404, { error: 'Activité introuvable.' });

  await db().execute(
    `INSERT INTO activity_feedback
      (user_id, activity_id, rpe, legs, cardio, pain, could_continue, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      id,
      clean(payload.rpe, 32) || null,
      clean(payload.legs, 64) || null,
      clean(payload.cardio, 64) || null,
      clean(payload.pain, 255) || null,
      clean(payload.couldContinue, 64) || null,
      clean(payload.note, 4000) || null
    ]
  );
  return json(res, 201, { ok: true });
}

async function coach(req, res, user) {
  const payload = await readJson(req, 64 * 1024);
  const message = clean(payload.message, 4000);
  if (!message) return json(res, 400, { error: 'Message vide.' });
  if (!process.env.OPENAI_API_KEY) return json(res, 503, { error: 'Coach IA non configuré.' });

  let threadId = Number(payload.threadId) || null;
  if (threadId) {
    const [threads] = await db().execute(
      'SELECT id FROM coach_threads WHERE id = ? AND user_id = ? LIMIT 1',
      [threadId, user.id]
    );
    if (!threads.length) threadId = null;
  }
  if (!threadId) {
    const [created] = await db().execute(
      'INSERT INTO coach_threads (user_id, title) VALUES (?, ?)',
      [user.id, message.slice(0, 80)]
    );
    threadId = created.insertId;
  }

  await db().execute(
    `INSERT INTO coach_messages (thread_id, user_id, role, content)
     VALUES (?, ?, 'user', ?)`,
    [threadId, user.id, message]
  );

  const context = await dashboardForUser(user);
  const [historyRows] = await db().execute(
    `SELECT role, content FROM coach_messages
     WHERE thread_id = ? AND user_id = ?
     ORDER BY id DESC LIMIT 12`,
    [threadId, user.id]
  );
  const history = historyRows.reverse();

  const input = `Tu es Coach, un coach d'endurance prudent dans une application privée multi-utilisateur.
Tu réponds uniquement à partir du contexte de l'athlète courant ci-dessous.
La prévention des blessures passe avant la performance. Pour l'endurance facile, la fréquence cardiaque de l'athlète est prioritaire.
Ne prétends jamais avoir modifié un plan ou une donnée si aucune action applicative ne l'a fait.
Si meta.metricsFresh est false, précise que les métriques quotidiennes ne sont pas fraîches et ne les utilise pas comme si elles dataient d'aujourd'hui.
Si todaySession est null, ne recycle jamais une ancienne séance comme séance du jour.

Contexte JSON:
${JSON.stringify(context)}

Historique récent:
${history.map(item => `${item.role}: ${item.content}`).join('\n')}

Message actuel: ${message}
Réponds en français, de façon concise, pratique et contextualisée.`;

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      reasoning: { effort: 'low' },
      input
    })
  });

  if (!response.ok) {
    const detail = await response.text();
    console.error('OpenAI', response.status, detail.slice(0, 1000));
    return json(res, 502, { error: 'Le coach IA est temporairement indisponible.' });
  }

  const data = await response.json();
  const reply = (data.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text)
    .join('\n')
    .trim() || 'Pas de réponse.';

  await db().execute(
    `INSERT INTO coach_messages
      (thread_id, user_id, role, content, model)
     VALUES (?, ?, 'assistant', ?, ?)`,
    [threadId, user.id, reply, process.env.OPENAI_MODEL || 'gpt-5.6-luna']
  );

  return json(res, 200, { reply, threadId });
}

async function getProviders(res, user) {
  return json(res, 200, { providers: await providerStatus(user.id) });
}

async function removeProvider(res, user, provider) {
  await disconnectProvider(user.id, provider);
  return json(res, 200, { ok: true });
}

export async function handleV5ApiRoute(req, res, url, user) {
  const path = url.pathname;
  if (req.method === 'GET' && path === '/api/v5/dashboard') {
    return json(res, 200, await dashboardForUser(user));
  }
  if (req.method === 'GET' && path === '/api/v5/providers') return getProviders(res, user);
  if (req.method === 'POST' && path === '/api/v5/objectives') return createObjective(req, res, user);
  if (req.method === 'POST' && path === '/api/v5/coach') return coach(req, res, user);

  let match = path.match(/^\/api\/v5\/objectives\/(\d+)\/activate$/);
  if (req.method === 'POST' && match) return activateObjective(res, user, match[1]);

  match = path.match(/^\/api\/v5\/sessions\/(\d+)\/complete$/);
  if (req.method === 'POST' && match) return completeSession(res, user, match[1]);

  match = path.match(/^\/api\/v5\/activities\/(\d+)\/feedback$/);
  if (req.method === 'POST' && match) return saveFeedback(req, res, user, match[1]);

  match = path.match(/^\/api\/v5\/providers\/(coros|garmin)\/disconnect$/);
  if (req.method === 'POST' && match) return removeProvider(res, user, match[1]);

  return false;
}
