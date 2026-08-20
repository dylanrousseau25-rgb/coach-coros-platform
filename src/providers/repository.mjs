import { db } from '../db/pool.mjs';
import { encryptSecret, decryptSecret } from '../security/encryption.mjs';

const ALLOWED = new Set(['coros', 'garmin']);

function providerName(value) {
  const provider = String(value || '').toLowerCase();
  if (!ALLOWED.has(provider)) throw new Error(`Provider non supporté: ${provider}`);
  return provider;
}

export async function providerStatus(userId) {
  const [rows] = await db().execute(
    `SELECT provider, provider_user_id AS providerUserId, status,
            token_expires_at AS tokenExpiresAt, scope,
            last_sync_at AS lastSyncAt, last_error AS lastError
     FROM provider_connections
     WHERE user_id = ?
     ORDER BY provider`,
    [userId]
  );
  return rows;
}

export async function providerConnection(userId, provider) {
  const [rows] = await db().execute(
    `SELECT *
     FROM provider_connections
     WHERE user_id = ? AND provider = ?
     LIMIT 1`,
    [userId, providerName(provider)]
  );
  const row = rows[0];
  if (!row) return null;

  return {
    ...row,
    accessToken: decryptSecret(row.access_token_encrypted),
    refreshToken: decryptSecret(row.refresh_token_encrypted)
  };
}

export async function saveProviderTokens({
  userId,
  provider,
  providerUserId = null,
  accessToken,
  refreshToken = null,
  expiresAt = null,
  scope = null
}) {
  const name = providerName(provider);
  if (!accessToken) throw new Error('accessToken requis');

  await db().execute(
    `INSERT INTO provider_connections
      (user_id, provider, provider_user_id, access_token_encrypted,
       refresh_token_encrypted, token_expires_at, scope, status, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'connected', NULL)
     ON DUPLICATE KEY UPDATE
       provider_user_id = VALUES(provider_user_id),
       access_token_encrypted = VALUES(access_token_encrypted),
       refresh_token_encrypted = COALESCE(VALUES(refresh_token_encrypted), refresh_token_encrypted),
       token_expires_at = VALUES(token_expires_at),
       scope = VALUES(scope),
       status = 'connected',
       last_error = NULL`,
    [
      userId,
      name,
      providerUserId,
      encryptSecret(accessToken),
      encryptSecret(refreshToken),
      expiresAt,
      scope
    ]
  );
}

export async function markProviderError(userId, provider, message) {
  await db().execute(
    `UPDATE provider_connections
     SET status = 'error', last_error = ?
     WHERE user_id = ? AND provider = ?`,
    [String(message || 'Erreur provider').slice(0, 4000), userId, providerName(provider)]
  );
}

export async function disconnectProvider(userId, provider) {
  await db().execute(
    `UPDATE provider_connections
     SET access_token_encrypted = NULL,
         refresh_token_encrypted = NULL,
         token_expires_at = NULL,
         status = 'revoked',
         last_error = NULL
     WHERE user_id = ? AND provider = ?`,
    [userId, providerName(provider)]
  );
}
