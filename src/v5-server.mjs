import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.mjs';
import { db } from './db/pool.mjs';
import { handleAuthRoute } from './auth/routes.mjs';
import { currentUser } from './auth/session.mjs';
import { handleV5ApiRoute } from './api/routes.mjs';
import { json, notFound } from './http.mjs';

const cfg = config();
const appOrigin = new URL(cfg.appUrl).origin;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const rateBuckets = new Map();

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function rateAllowed(key, limit, windowMs) {
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  bucket.count += 1;
  if (bucket.count > limit) return false;
  return true;
}

function originAllowed(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === appOrigin;
}

async function requireUser(req, res) {
  const user = await currentUser(req);
  if (!user) {
    json(res, 401, { error: 'Non authentifié.' });
    return null;
  }
  return user;
}

async function serveStatic(res, pathname) {
  const requested = pathname === '/'
    ? '/index.html'
    : pathname === '/app.js'
      ? '/v5-app.js'
      : pathname;
  const normalized = path.posix.normalize(requested).replace(/^\/+/, '');
  if (normalized.startsWith('..')) return false;
  let filePath = path.resolve(publicDir, normalized);
  if (!filePath.startsWith(`${publicDir}${path.sep}`) && filePath !== publicDir) return false;

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
    const data = await readFile(filePath);
    res.writeHead(200, {
      'content-type': contentTypes[path.extname(filePath)] || 'application/octet-stream',
      'cache-control': /\.(?:html|js|css|webmanifest)$/.test(filePath)
        ? 'no-cache'
        : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'same-origin'
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, cfg.appUrl);

    if (!originAllowed(req)) {
      return json(res, 403, { error: 'Origine de requête refusée.' });
    }

    if (url.pathname.startsWith('/auth/')) {
      if (req.method === 'POST' && ['/auth/login', '/auth/register'].includes(url.pathname)) {
        const key = `auth:${clientIp(req)}`;
        if (!rateAllowed(key, 20, 15 * 60_000)) {
          return json(res, 429, { error: 'Trop de tentatives. Réessaie plus tard.' });
        }
      }
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

    if (url.pathname.startsWith('/api/v5/')) {
      const user = await requireUser(req, res);
      if (!user) return;
      if (req.method === 'POST' && url.pathname === '/api/v5/coach') {
        if (!rateAllowed(`coach:${user.id}`, 30, 60_000)) {
          return json(res, 429, { error: 'Trop de messages envoyés au coach. Réessaie dans une minute.' });
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/v5/bootstrap') {
        return json(res, 200, {
          user,
          phase: 'V5-RC1',
          message: 'Authentification, dashboard et mutations multi-utilisateur opérationnels.'
        });
      }
      const handled = await handleV5ApiRoute(req, res, url, user);
      if (handled !== false) return;
      return notFound(res);
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (await serveStatic(res, url.pathname)) return;
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
