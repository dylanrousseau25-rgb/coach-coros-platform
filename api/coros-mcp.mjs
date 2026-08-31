import crypto from 'node:crypto';

const DEFAULT_ISSUER = process.env.COROS_MCP_ISSUER || 'https://mcpeu.coros.com';
const DEFAULT_MCP_URL = process.env.COROS_MCP_URL || 'https://mcpeu.coros.com/mcp';
const DEFAULT_SCOPES = 'openid offline_access mcp.tools';
const AUTH_COOKIE = 'coach_coros_auth';
const ACCESS_COOKIE = 'coach_coros_access';
const PENDING_COOKIE = 'coach_coros_pending';
const CACHE_COOKIE = 'coach_coros_cache';

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

function keyMaterial() {
  const secret = process.env.COROS_COOKIE_SECRET || process.env.SESSION_SECRET || process.env.OPENAI_API_KEY;
  if (!secret) throw new Error('COROS_COOKIE_SECRET manquant');
  return crypto.createHash('sha256').update(`coach-coros-cookie:${secret}`).digest();
}

function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(), iv);
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${base64url(iv)}.${base64url(tag)}.${base64url(encrypted)}`;
}

function unseal(value) {
  if (!value) return null;
  try {
    const [ivText, tagText, encryptedText] = String(value).split('.');
    if (!ivText || !tagText || !encryptedText) return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial(), Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64url')),
      decipher.final()
    ]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch {
    return null;
  }
}

export function parseCookies(request) {
  const header = request.headers.get('cookie') || '';
  const result = {};
  for (const chunk of header.split(';')) {
    const index = chunk.indexOf('=');
    if (index < 0) continue;
    const key = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function cookie(name, value, { maxAge = 60 * 60 * 24 * 180, httpOnly = true } = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    `Max-Age=${maxAge}`,
    'Secure',
    'SameSite=Lax'
  ];
  if (httpOnly) parts.push('HttpOnly');
  return parts.join('; ');
}

function clearCookie(name) {
  return `${name}=; Path=/; Max-Age=0; Secure; SameSite=Lax; HttpOnly`;
}

function randomVerifier() {
  return base64url(crypto.randomBytes(32));
}

function challengeFor(verifier) {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

async function readJsonResponse(response, label) {
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { text }; }
  if (!response.ok) {
    const safe = body?.error_description || body?.error || body?.message || text || `${response.status}`;
    throw new Error(`${label}: ${safe}`);
  }
  return body;
}

export async function startCorosOAuth(request) {
  const url = new URL(request.url);
  const issuer = DEFAULT_ISSUER.replace(/\/$/, '');
  const redirectUri = `${url.origin}/api/coros/callback`;
  const register = await fetch(`${issuer}/connect/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_name: 'Coach COROS Platform',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      scope: DEFAULT_SCOPES,
      token_endpoint_auth_method: 'none'
    })
  });
  const registration = await readJsonResponse(register, 'Inscription OAuth COROS');
  if (!registration.client_id) throw new Error('COROS n’a pas renvoyé de client_id');

  const verifier = randomVerifier();
  const state = base64url(crypto.randomBytes(24));
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: registration.client_id,
    redirect_uri: redirectUri,
    scope: DEFAULT_SCOPES,
    code_challenge: challengeFor(verifier),
    code_challenge_method: 'S256',
    resource: DEFAULT_MCP_URL,
    state
  });

  return {
    location: `${issuer}/oauth2/authorize?${params}`,
    setCookies: [cookie(PENDING_COOKIE, seal({
      clientId: registration.client_id,
      verifier,
      state,
      redirectUri,
      createdAt: Date.now()
    }), { maxAge: 10 * 60 })]
  };
}

async function exchangeToken(form) {
  const issuer = DEFAULT_ISSUER.replace(/\/$/, '');
  const response = await fetch(`${issuer}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form)
  });
  return readJsonResponse(response, 'Token COROS');
}

function tokenCookies(token, clientId) {
  const expiresIn = Math.max(60, Number(token.expires_in || 3600));
  const refreshToken = token.refresh_token;
  if (!refreshToken) throw new Error('COROS n’a pas renvoyé de refresh_token');
  const auth = cookie(AUTH_COOKIE, seal({
    clientId,
    refreshToken,
    scope: token.scope || DEFAULT_SCOPES,
    savedAt: Date.now()
  }));
  const access = token.access_token
    ? cookie(ACCESS_COOKIE, seal({
        accessToken: token.access_token,
        expiresAt: Date.now() + expiresIn * 1000
      }), { maxAge: expiresIn })
    : clearCookie(ACCESS_COOKIE);
  return [auth, access];
}

export async function finishCorosOAuth(request) {
  const url = new URL(request.url);
  const cookies = parseCookies(request);
  const pending = unseal(cookies[PENDING_COOKIE]);
  if (!pending) throw new Error('Session de connexion COROS expirée. Relance la connexion.');
  if (Date.now() - Number(pending.createdAt || 0) > 10 * 60 * 1000) throw new Error('Session OAuth COROS expirée.');
  if (!url.searchParams.get('code')) throw new Error(url.searchParams.get('error_description') || url.searchParams.get('error') || 'Code OAuth COROS manquant');
  if (url.searchParams.get('state') !== pending.state) throw new Error('État OAuth COROS invalide');

  const token = await exchangeToken({
    grant_type: 'authorization_code',
    client_id: pending.clientId,
    code: url.searchParams.get('code'),
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier
  });

  return {
    location: '/?coros=connected',
    setCookies: [...tokenCookies(token, pending.clientId), clearCookie(PENDING_COOKIE)]
  };
}

async function currentAccess(request) {
  const cookies = parseCookies(request);
  const auth = unseal(cookies[AUTH_COOKIE]);
  if (!auth?.refreshToken || !auth?.clientId) return { connected: false, setCookies: [] };

  const access = unseal(cookies[ACCESS_COOKIE]);
  if (access?.accessToken && Number(access.expiresAt || 0) > Date.now() + 60_000) {
    return { connected: true, auth, accessToken: access.accessToken, setCookies: [] };
  }

  const token = await exchangeToken({
    grant_type: 'refresh_token',
    client_id: auth.clientId,
    refresh_token: auth.refreshToken
  });
  return {
    connected: true,
    auth,
    accessToken: token.access_token,
    setCookies: tokenCookies(token, auth.clientId)
  };
}

function parseSseOrJson(text, contentType) {
  if (!text) return {};
  if (!String(contentType || '').includes('text/event-stream')) return JSON.parse(text);
  const payloads = [];
  let lines = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      if (lines.length) {
        payloads.push(lines.join('\n'));
        lines = [];
      }
      continue;
    }
    if (line.startsWith('data:')) lines.push(line.slice(5).trimStart());
  }
  if (lines.length) payloads.push(lines.join('\n'));
  for (let index = payloads.length - 1; index >= 0; index--) {
    try { return JSON.parse(payloads[index]); } catch {}
  }
  throw new Error('Réponse MCP COROS illisible');
}

async function mcpRpc(accessToken, method, params, id = 1) {
  const response = await fetch(DEFAULT_MCP_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP COROS ${response.status}: ${text.slice(0, 240)}`);
  const payload = parseSseOrJson(text, response.headers.get('content-type'));
  if (payload?.error) throw new Error(payload.error.message || 'Erreur MCP COROS');
  return payload;
}

async function mcpTool(accessToken, name, argumentsObject = {}) {
  await mcpRpc(accessToken, 'initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'Coach COROS Platform', version: '1.0.0' }
  }, 1);
  const payload = await mcpRpc(accessToken, 'tools/call', {
    name,
    arguments: argumentsObject
  }, 2);
  return extractToolData(payload?.result);
}

function parseMaybeJson(text) {
  if (typeof text !== 'string') return text;
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { return text; }
}

function extractToolData(result) {
  if (!result) return null;
  if (result.structuredContent !== undefined) return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  const values = content
    .filter(item => item && (item.type === 'text' || typeof item.text === 'string'))
    .map(item => parseMaybeJson(item.text));
  if (values.length === 1) return values[0];
  if (values.length > 1) return values;
  return result;
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function scalar(value) {
  return ['string', 'number', 'boolean'].includes(typeof value) ? value : null;
}

function findValue(root, candidateKeys) {
  const wanted = new Set(candidateKeys.map(normalizeKey));
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    for (const [key, value] of Object.entries(current)) {
      if (wanted.has(normalizeKey(key))) {
        const simple = scalar(value);
        if (simple !== null && simple !== '') return simple;
      }
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return null;
}

function findRecordArray(root) {
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      if (current.some(item => item && typeof item === 'object' && ('labelId' in item || 'sportType' in item || 'startTimestamp' in item))) return current;
      queue.push(...current);
      continue;
    }
    queue.push(...Object.values(current).filter(value => value && typeof value === 'object'));
  }
  return [];
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const normalized = value.replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    if (normalized) return Number(normalized[0]);
  }
  return null;
}

function formatSleepDuration(value) {
  if (typeof value === 'string' && /h|min|:/.test(value)) return value;
  const number = numberValue(value);
  if (number === null) return null;
  let minutes = number;
  if (number > 24 * 60) minutes = Math.round(number / 60);
  else if (number > 0 && number <= 24) minutes = Math.round(number * 60);
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return `${hours} h ${String(rest).padStart(2, '0')}`;
}

function compactDate(value) {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function normalizeActivity(record) {
  if (!record || typeof record !== 'object') return null;
  const date = compactDate(record.date || record.startDate || record.startTime || record.startTimestamp)
    || (Number(record.startTimestamp) ? new Date(Number(record.startTimestamp) * 1000).toISOString().slice(0, 10) : null);
  const distance = record.distanceKm ?? record.distance ?? record.totalDistance ?? null;
  const duration = record.duration ?? record.workoutTime ?? record.durationMinutes ?? null;
  const pace = record.averagePace ?? record.avgPace ?? record.pace ?? record.averageSpeed ?? null;
  const sport = record.sportName || record.sport || record.sportTypeName || record.name || 'Activité COROS';
  return {
    id: record.labelId ? `coros-${record.labelId}` : `coros-${record.startTimestamp || date || crypto.randomUUID()}`,
    labelId: record.labelId || null,
    sportType: record.sportType ?? null,
    date,
    sport: String(sport),
    distance: typeof distance === 'number' ? `${distance.toLocaleString('fr-FR')} km` : (distance ? String(distance) : '—'),
    duration: duration ? String(duration) : '—',
    pace: pace ? String(pace) : '—',
    avgHr: numberValue(record.avgHr ?? record.averageHeartRate ?? record.avgHeartRate),
    maxHr: numberValue(record.maxHr ?? record.maxHeartRate),
    trainingFocus: record.trainingFocus || record.focus || 'COROS',
    source: 'COROS MCP',
    coachNote: 'Activité synchronisée depuis COROS.'
  };
}

function localDateIso() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIMEZONE || 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function yyyymmdd(dateIso) {
  return dateIso.replaceAll('-', '');
}

function addDays(dateIso, days) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function readCorosCache(request) {
  const cookies = parseCookies(request);
  return unseal(cookies[CACHE_COOKIE]);
}

export function hasCorosConnection(request) {
  const cookies = parseCookies(request);
  const auth = unseal(cookies[AUTH_COOKIE]);
  return Boolean(auth?.refreshToken && auth?.clientId);
}

export function corosStatus(request) {
  const cache = readCorosCache(request);
  const connected = hasCorosConnection(request);
  return {
    connected,
    mode: connected ? 'mcp' : 'demo',
    lastSyncAt: cache?.syncedAt || null,
    dataDate: cache?.date || null,
    region: 'Europe'
  };
}

export async function syncCoros(request) {
  const access = await currentAccess(request);
  if (!access.connected || !access.accessToken) throw new Error('COROS non connecté');
  const today = localDateIso();
  const start = addDays(today, -7);
  const timezone = process.env.APP_TIMEZONE || 'Europe/Paris';

  const jobs = {
    recovery: ['queryRecoveryStatus', {}],
    sleep: ['querySleepData', { startDate: yyyymmdd(addDays(today, -1)), endDate: yyyymmdd(today), days: 2, timezone }],
    load: ['queryTrainingLoadAssessment', { days: 7 }],
    fitness: ['queryFitnessAssessmentOverview', {}],
    activities: ['querySportRecords', { startDate: yyyymmdd(start), endDate: yyyymmdd(today), limit: 10, timezone }]
  };

  const entries = await Promise.all(Object.entries(jobs).map(async ([key, [name, args]]) => {
    try {
      return [key, await mcpTool(access.accessToken, name, args), null];
    } catch (error) {
      return [key, null, error?.message || String(error)];
    }
  }));
  const raw = Object.fromEntries(entries.map(([key, value]) => [key, value]));
  const errors = Object.fromEntries(entries.filter(([, , error]) => error).map(([key, , error]) => [key, error]));

  const recovery = numberValue(findValue(raw.recovery, ['recoveryPercentage', 'recoveryPercent', 'recoveryScore', 'recoveryRate', 'recovery']));
  const sleepScore = numberValue(findValue(raw.sleep, ['sleepScore', 'sleepQualityScore', 'score']));
  const sleepDuration = formatSleepDuration(findValue(raw.sleep, ['mainSleepDuration', 'sleepDuration', 'totalSleepDuration', 'sleepMinutes', 'sleepTime']));
  const shortTermLoad = numberValue(findValue(raw.load, ['shortTermLoad', 'shortLoad', 'shortTermTrainingLoad', 'atl']));
  const longTermLoad = numberValue(findValue(raw.load, ['longTermLoad', 'longLoad', 'longTermTrainingLoad', 'ctl']));
  const loadRatio = numberValue(findValue(raw.load, ['loadRatio', 'trainingLoadRatio', 'ratio']));
  const vo2max = numberValue(findValue(raw.fitness, ['vo2max', 'vo2Max', 'runningVo2max']));
  const thresholdPace = findValue(raw.fitness, ['thresholdPace', 'lactateThresholdPace', 'ltPace']);
  const thresholdHr = numberValue(findValue(raw.fitness, ['thresholdHeartRate', 'lactateThresholdHeartRate', 'thresholdHr', 'ltHr']));
  const halfPrediction = findValue(raw.fitness, ['halfMarathon', 'halfMarathonPrediction', 'halfPrediction']);

  const records = findRecordArray(raw.activities)
    .map(normalizeActivity)
    .filter(Boolean)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  const cache = {
    version: 1,
    date: today,
    syncedAt: new Date().toISOString(),
    metrics: {
      recovery,
      sleepScore,
      sleepDuration,
      shortTermLoad,
      longTermLoad,
      loadRatio,
      vo2max,
      thresholdPace: thresholdPace ? String(thresholdPace) : null,
      halfPrediction: halfPrediction ? String(halfPrediction) : null
    },
    thresholdHr,
    latestActivity: records[0] || null,
    errors
  };

  return {
    cache,
    setCookies: [
      ...access.setCookies,
      cookie(CACHE_COOKIE, seal(cache), { maxAge: 60 * 60 * 24 * 7 })
    ]
  };
}

export function disconnectCoros() {
  return [AUTH_COOKIE, ACCESS_COOKIE, PENDING_COOKIE, CACHE_COOKIE].map(clearCookie);
}

export function overlayCorosDashboard(base, request) {
  const cache = readCorosCache(request);
  const connected = hasCorosConnection(request);
  const today = base?.meta?.today || localDateIso();
  const live = Boolean(connected && cache?.date === today);
  const result = structuredClone(base);
  result.meta = {
    ...(result.meta || {}),
    corosMode: live ? 'mcp' : 'demo',
    corosConnected: connected,
    corosLastSyncAt: cache?.syncedAt || null,
    corosSyncErrors: cache?.errors || null
  };
  if (!live) return result;

  result.metrics = {
    recovery: cache.metrics?.recovery ?? undefined,
    sleepScore: cache.metrics?.sleepScore ?? undefined,
    sleepDuration: cache.metrics?.sleepDuration ?? undefined,
    shortTermLoad: cache.metrics?.shortTermLoad ?? undefined,
    longTermLoad: cache.metrics?.longTermLoad ?? undefined,
    loadRatio: cache.metrics?.loadRatio ?? undefined,
    vo2max: cache.metrics?.vo2max ?? undefined,
    thresholdPace: cache.metrics?.thresholdPace ?? undefined,
    halfPrediction: cache.metrics?.halfPrediction ?? undefined
  };
  result.latestActivity = cache.latestActivity || null;
  result.heartRateZones = cache.thresholdHr
    ? { ...(result.heartRateZones || {}), source: 'COROS MCP', thresholdHr: cache.thresholdHr }
    : { source: 'COROS MCP', model: 'Synchronisé', thresholdHr: null, zones: [] };
  return result;
}
