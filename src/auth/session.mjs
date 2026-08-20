import { db } from '../db/pool.mjs';
import { config, isProduction } from '../config.mjs';
import { hashIp, hashOpaqueToken, newSessionToken } from './tokens.mjs';

export const SESSION_COOKIE = 'coach_session';

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function sessionCookie(token, maxAgeSeconds) {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`
  ];
  if (isProduction()) attrs.push('Secure');
  return attrs.join('; ');
}

export function clearSessionCookie() {
  return sessionCookie('', 0);
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
}

export async function createSession(userId, req) {
  const cfg = config();
  const token = newSessionToken();
  const tokenHash = hashOpaqueToken(token);
  const expires = new Date(Date.now() + cfg.sessionTtlDays * 86400000);

  await db().execute(
    `INSERT INTO sessions
      (user_id, token_hash, expires_at, user_agent, ip_hash)
     VALUES (?, ?, ?, ?, ?)`,
    [
      userId,
      tokenHash,
      expires,
      String(req.headers['user-agent'] || '').slice(0, 512) || null,
      hashIp(clientIp(req))
    ]
  );

  return { token, expires, maxAgeSeconds: cfg.sessionTtlDays * 86400 };
}

export async function destroySession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return;
  await db().execute('DELETE FROM sessions WHERE token_hash = ?', [hashOpaqueToken(token)]);
}

export async function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;

  const [rows] = await db().execute(
    `SELECT
       u.id, u.email, u.display_name AS displayName, u.initials,
       u.timezone, u.locale, u.role, u.status
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ?
       AND s.expires_at > UTC_TIMESTAMP()
       AND u.status = 'active'
     LIMIT 1`,
    [hashOpaqueToken(token)]
  );

  const user = rows[0] || null;
  if (user) {
    await db().execute(
      `UPDATE sessions
       SET last_used_at = CURRENT_TIMESTAMP
       WHERE token_hash = ?`,
      [hashOpaqueToken(token)]
    );
  }
  return user;
}
