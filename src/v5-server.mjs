import http from 'node:http';
import { config } from './config.mjs';
import { db } from './db/pool.mjs';
import { handleAuthRoute } from './auth/routes.mjs';
import { currentUser } from './auth/session.mjs';
import { dashboardForUser } from './dashboard/repository.mjs';
import { json, notFound } from './http.mjs';

const cfg = config();

async function requireUser(req, res) {
  const user = await currentUser(req);
  if (!user) {
    json(res, 401, { error: 'Non authentifié.' });
    return null;
  }
  return user;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, cfg.appUrl);

    if (url.pathname.startsWith('/auth/')) {
      const handled = await handleAuthRoute(req, res, url.pathname);
      if (handled !== false) return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      await db().query('SELECT 1');
      return json(res, 200, {
        ok: true,
        service: 'coach-v5',
        database: 'connected',
        now: new Date().toISOString()
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/v5/bootstrap') {
      const user = await requireUser(req, res);
      if (!user) return;
      return json(res, 200, {
        user,
        phase: 'V5-C/D',
        message: 'Auth, persistance sportive et dashboard isolé par utilisateur opérationnels.'
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/v5/dashboard') {
      const user = await requireUser(req, res);
      if (!user) return;
      return json(res, 200, await dashboardForUser(user));
    }

    return notFound(res);
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, {
      error: error.status ? error.message : 'Erreur serveur'
    });
  }
});

const passenger = typeof globalThis.PhusionPassenger !== 'undefined';
if (passenger) globalThis.PhusionPassenger.configure({ autoInstall: false });
const listenTarget = passenger ? 'passenger' : cfg.port;

server.listen(listenTarget, () => {
  console.log(`Coach V5 → ${cfg.appUrl} (${passenger ? 'Passenger' : `port ${cfg.port}`})`);
});
