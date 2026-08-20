import { db, withTransaction } from '../db/pool.mjs';
import { readJson, json } from '../http.mjs';
import { hashPassword, verifyPassword } from './password.mjs';
import {
  clearSessionCookie,
  createSession,
  currentUser,
  destroySession,
  sessionCookie
} from './session.mjs';
import { hashInviteCode } from './tokens.mjs';

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function initials(name) {
  return String(name || '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() || '')
    .join('');
}

function publicUser(user) {
  return {
    id: Number(user.id),
    email: user.email,
    displayName: user.displayName ?? user.display_name,
    initials: user.initials,
    timezone: user.timezone,
    locale: user.locale,
    role: user.role
  };
}

async function register(req, res) {
  const payload = await readJson(req);
  const email = normalizeEmail(payload.email);
  const displayName = String(payload.displayName || '').trim();
  const password = String(payload.password || '');
  const inviteCode = String(payload.inviteCode || '').trim();

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return json(res, 400, { error: 'Adresse email invalide.' });
  }
  if (displayName.length < 2 || displayName.length > 100) {
    return json(res, 400, { error: 'Nom invalide.' });
  }
  if (!inviteCode) return json(res, 400, { error: "Code d'invitation requis." });

  let passwordHash;
  try {
    passwordHash = await hashPassword(password);
  } catch (error) {
    return json(res, 400, { error: error.message });
  }

  try {
    const user = await withTransaction(async connection => {
      const inviteHash = hashInviteCode(inviteCode);
      const [invites] = await connection.execute(
        `SELECT id, max_uses, uses, expires_at, disabled_at
         FROM invite_codes
         WHERE code_hash = ?
         FOR UPDATE`,
        [inviteHash]
      );
      const invite = invites[0];
      if (
        !invite ||
        invite.disabled_at ||
        invite.uses >= invite.max_uses ||
        (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now())
      ) {
        const error = new Error("Code d'invitation invalide ou expiré.");
        error.status = 400;
        throw error;
      }

      const [existing] = await connection.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email]);
      if (existing.length) {
        const error = new Error('Un compte existe déjà avec cet email.');
        error.status = 409;
        throw error;
      }

      const [result] = await connection.execute(
        `INSERT INTO users
          (email, password_hash, display_name, initials, timezone, locale, role, status)
         VALUES (?, ?, ?, ?, ?, ?, 'user', 'active')`,
        [
          email,
          passwordHash,
          displayName,
          initials(displayName),
          String(payload.timezone || 'Europe/Paris').slice(0, 64),
          String(payload.locale || 'fr-FR').slice(0, 16)
        ]
      );

      await connection.execute('UPDATE invite_codes SET uses = uses + 1 WHERE id = ?', [invite.id]);
      const [rows] = await connection.execute(
        `SELECT id, email, display_name, initials, timezone, locale, role
         FROM users WHERE id = ?`,
        [result.insertId]
      );
      return rows[0];
    });

    const session = await createSession(user.id, req);
    return json(res, 201, { user: publicUser(user) }, {
      'set-cookie': sessionCookie(session.token, session.maxAgeSeconds)
    });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') return json(res, 409, { error: 'Compte déjà existant.' });
    return json(res, error.status || 500, { error: error.message || 'Erreur inscription.' });
  }
}

async function login(req, res) {
  const payload = await readJson(req);
  const email = normalizeEmail(payload.email);
  const password = String(payload.password || '');

  const [rows] = await db().execute(
    `SELECT id, email, password_hash, display_name, initials, timezone, locale, role, status
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email]
  );
  const user = rows[0];
  if (!user || user.status !== 'active' || !(await verifyPassword(password, user.password_hash))) {
    return json(res, 401, { error: 'Email ou mot de passe incorrect.' });
  }

  await db().execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
  const session = await createSession(user.id, req);
  return json(res, 200, { user: publicUser(user) }, {
    'set-cookie': sessionCookie(session.token, session.maxAgeSeconds)
  });
}

async function logout(req, res) {
  await destroySession(req);
  return json(res, 200, { ok: true }, { 'set-cookie': clearSessionCookie() });
}

async function me(req, res) {
  const user = await currentUser(req);
  if (!user) return json(res, 401, { error: 'Non authentifié.' });
  return json(res, 200, { user: publicUser(user) });
}

export async function handleAuthRoute(req, res, pathname) {
  if (req.method === 'POST' && pathname === '/auth/register') return register(req, res);
  if (req.method === 'POST' && pathname === '/auth/login') return login(req, res);
  if (req.method === 'POST' && pathname === '/auth/logout') return logout(req, res);
  if (req.method === 'GET' && pathname === '/auth/me') return me(req, res);
  return false;
}
