import baseRouter from './router.mjs';
import {
  startCorosOAuth,
  finishCorosOAuth,
  corosStatus,
  syncCoros,
  disconnectCoros,
  overlayCorosDashboard,
  hasCorosConnection,
  readCorosCache
} from './coros-mcp.mjs';

function json(body, status = 200, cookies = []) {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(JSON.stringify(body), { status, headers });
}

function redirect(location, cookies = []) {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const value of cookies) headers.append('set-cookie', value);
  return new Response(null, { status: 302, headers });
}

async function baseDashboard(request) {
  const url = new URL(request.url);
  const baseRequest = new Request(`${url.origin}/api/router?path=dashboard`, {
    method: 'GET',
    headers: request.headers
  });
  const response = await baseRouter.fetch(baseRequest);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || `Dashboard ${response.status}`);
  return data;
}

async function liveCoachReply(data, message) {
  if (!process.env.OPENAI_API_KEY) return null;
  const context = {
    athlete: data.athlete,
    heartRateZones: data.heartRateZones,
    metrics: data.metrics,
    dataFreshness: {
      today: data.meta?.today,
      corosLive: data.meta?.corosMode === 'mcp',
      lastSyncAt: data.meta?.corosLastSyncAt || null
    },
    activeObjective: data.activeObjective,
    activePlan: data.activePlan,
    todaySession: data.todaySession,
    latestActivity: data.latestActivity,
    recentFeedback: (data.feedback || []).slice(0, 8)
  };
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
      reasoning: { effort: 'low' },
      input: `Tu es Coach COROS, coach d'endurance prudent.\nContexte JSON:\n${JSON.stringify(context)}\nMessage de l'athlète: ${message}\nRéponds en français, de façon concise et pratique. Utilise uniquement les métriques COROS quand dataFreshness.corosLive est vrai. Prévention des blessures avant la performance. Pour les séances faciles, la fréquence cardiaque reste prioritaire quand des zones synchronisées sont disponibles.`
    })
  });
  if (!response.ok) throw new Error(`OpenAI API ${response.status}: ${await response.text()}`);
  const payload = await response.json();
  return (payload.output || [])
    .flatMap(item => item.content || [])
    .filter(item => item.type === 'output_text')
    .map(item => item.text)
    .join('\n')
    .trim() || 'Pas de réponse.';
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const route = url.searchParams.get('path') || '';
    const method = request.method.toUpperCase();

    try {
      if (method === 'GET' && route === 'coros/connect') {
        const result = await startCorosOAuth(request);
        return redirect(result.location, result.setCookies);
      }

      if (method === 'GET' && route === 'coros/callback') {
        const result = await finishCorosOAuth(request);
        return redirect(result.location, result.setCookies);
      }

      if (method === 'GET' && route === 'coros/status') {
        return json(corosStatus(request));
      }

      if (method === 'POST' && route === 'coros/sync') {
        const result = await syncCoros(request);
        return json({
          ok: true,
          syncedAt: result.cache.syncedAt,
          dataDate: result.cache.date,
          errors: result.cache.errors
        }, 200, result.setCookies);
      }

      if (method === 'POST' && route === 'coros/disconnect') {
        return json({ ok: true }, 200, disconnectCoros());
      }

      if (method === 'GET' && route === 'dashboard') {
        const baseResponse = await baseRouter.fetch(request);
        const base = await baseResponse.json();
        if (!baseResponse.ok) return json(base, baseResponse.status);
        return json(overlayCorosDashboard(base, request));
      }

      if (method === 'POST' && route === 'coach' && hasCorosConnection(request)) {
        const cache = readCorosCache(request);
        const dashboard = overlayCorosDashboard(await baseDashboard(request), request);
        if (dashboard.meta?.corosMode === 'mcp' && cache) {
          const { message } = await request.json();
          if (!message?.trim()) return json({ error: 'Message vide' }, 400);
          const reply = await liveCoachReply(dashboard, message.trim());
          if (reply) return json({ reply });
        }
      }

      return baseRouter.fetch(request);
    } catch (error) {
      if (route === 'coros/callback') {
        const message = encodeURIComponent(error?.message || 'Connexion COROS impossible');
        return redirect(`/?coros=error&message=${message}`);
      }
      if (route.startsWith('coros/')) {
        return json({ error: error?.message || 'Erreur COROS' }, route === 'coros/sync' ? 502 : 500);
      }
      return json({ error: error?.message || 'Erreur serveur' }, 500);
    }
  }
};
