import http from 'node:http';
import { config } from './config.mjs';
import { db } from './db/pool.mjs';
import { handleAuthRoute } from './auth/routes.mjs';
import { currentUser } from './auth/session.mjs';
import { json, notFound } from './http.mjs';

const cfg = config();

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
      const user = await currentUser(req);
      if (!user) return json(res, 401, { error: 'Non authentifié.' });
      return json(res, 200, {
        user,
        phase: 'V5-A/B',
        message: 'Auth et base multi-utilisateur opérationnelles. Migration sportive à venir.'
      });
    }

    return notFound(res);
  } catch (error) {
    console.error(error);
    return json(res, error.status || 500, {
      error: error.status ? error.message : 'Erreur serveur'
    });
  }
});

server.listen(cfg.port, () => {
  console.log(`Coach V5 auth foundation → ${cfg.appUrl} (port ${cfg.port})`);
});
