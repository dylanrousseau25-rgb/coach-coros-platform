import crypto from 'node:crypto';

const ISSUER = (process.env.COROS_MCP_ISSUER || 'https://mcpeu.coros.com').replace(/\/$/, '');
const MCP_URL = process.env.COROS_MCP_URL || 'https://mcpeu.coros.com/mcp';
const AUTH_COOKIE = 'coach_coros_auth';
const ACCESS_COOKIE = 'coach_coros_access';
const CACHE_COOKIE = 'coach_coros_cache';
const DEFAULT_SCOPES = 'openid offline_access mcp.tools';

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

function parseCookies(request) {
  const result = {};
  for (const chunk of (request.headers.get('cookie') || '').split(';')) {
    const index = chunk.indexOf('=');
    if (index < 0) continue;
    const key = chunk.slice(0, index).trim();
    const value = chunk.slice(index + 1).trim();
    if (key) result[key] = decodeURIComponent(value);
  }
  return result;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; Secure; SameSite=Lax; HttpOnly`;
}

async function tokenRequest(form) {
  const response = await fetch(`${ISSUER}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams(form)
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!response.ok) throw new Error(body.error_description || body.error || `Token COROS ${response.status}`);
  return body;
}

async function currentAccess(request) {
  const cookies = parseCookies(request);
  const auth = unseal(cookies[AUTH_COOKIE]);
  if (!auth?.clientId || !auth?.refreshToken) throw new Error('COROS non connecté');

  const access = unseal(cookies[ACCESS_COOKIE]);
  if (access?.accessToken && Number(access.expiresAt || 0) > Date.now() + 60_000) {
    return { accessToken: access.accessToken, setCookies: [] };
  }

  const token = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: auth.clientId,
    refresh_token: auth.refreshToken
  });
  if (!token.access_token) throw new Error('COROS n’a pas renvoyé de nouveau access_token');
  const expiresIn = Math.max(60, Number(token.expires_in || 3600));
  const refreshToken = token.refresh_token || auth.refreshToken;
  return {
    accessToken: token.access_token,
    setCookies: [
      cookie(AUTH_COOKIE, seal({
        clientId: auth.clientId,
        refreshToken,
        scope: token.scope || auth.scope || DEFAULT_SCOPES,
        savedAt: Date.now()
      }), 60 * 60 * 24 * 180),
      cookie(ACCESS_COOKIE, seal({
        accessToken: token.access_token,
        expiresAt: Date.now() + expiresIn * 1000
      }), expiresIn)
    ]
  };
}

function parseSseOrJson(text, contentType) {
  if (!text) return {};
  if (!String(contentType || '').includes('text/event-stream')) {
    try { return JSON.parse(text); } catch { return { result: { content: [{ type: 'text', text }] } }; }
  }
  const payloads = [];
  let current = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) {
      if (current.length) payloads.push(current.join('\n'));
      current = [];
      continue;
    }
    if (line.startsWith('data:')) current.push(line.slice(5).trimStart());
  }
  if (current.length) payloads.push(current.join('\n'));
  for (let index = payloads.length - 1; index >= 0; index--) {
    try { return JSON.parse(payloads[index]); } catch {}
  }
  throw new Error('Réponse MCP COROS illisible');
}

async function rpc(accessToken, method, params, id) {
  const response = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/json, text/event-stream',
      'content-type': 'application/json'
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} })
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MCP COROS ${response.status}: ${text.slice(0, 160)}`);
  const payload = parseSseOrJson(text, response.headers.get('content-type'));
  if (payload?.error) throw new Error(payload.error.message || 'Erreur MCP COROS');
  return payload;
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
  const values = (Array.isArray(result.content) ? result.content : [])
    .filter(item => item && typeof item.text === 'string')
    .map(item => parseMaybeJson(item.text));
  if (values.length === 1) return values[0];
  if (values.length) return values;
  return result;
}

async function tool(accessToken, name, args = {}, retries = 1) {
  for (let attempt = 0; ; attempt++) {
    try {
      await rpc(accessToken, 'initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'Coach COROS Platform', version: '1.1.0' }
      }, 1);
      return extractToolData((await rpc(accessToken, 'tools/call', { name, arguments: args }, 2))?.result);
    } catch (error) {
      if (attempt >= retries || !/404/.test(String(error?.message || error))) throw error;
      await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)));
    }
  }
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function findStructured(root, candidateKeys) {
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
      if (wanted.has(normalizeKey(key)) && ['string', 'number', 'boolean'].includes(typeof value) && value !== '') return value;
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return null;
}

function flattenText(root) {
  if (root == null) return '';
  if (typeof root === 'string') return root;
  const lines = [];
  const queue = [root];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (current == null) continue;
    if (typeof current === 'string') {
      lines.push(current);
      continue;
    }
    if (typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    for (const [key, value] of Object.entries(current)) {
      if (['string', 'number', 'boolean'].includes(typeof value)) lines.push(`${key}: ${value}`);
      else if (value && typeof value === 'object') queue.push(value);
    }
  }
  return lines.join('\n');
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function textNumber(root, structuredKeys, regexes) {
  const structured = findStructured(root, structuredKeys);
  const direct = numberValue(structured);
  if (direct !== null) return direct;
  const text = flattenText(root);
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match) {
      const value = numberValue(match[1]);
      if (value !== null) return value;
    }
  }
  return null;
}

function textValue(root, structuredKeys, regexes) {
  const structured = findStructured(root, structuredKeys);
  if (structured !== null && structured !== '') return String(structured).trim();
  const text = flattenText(root);
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function formatSleepDuration(value) {
  if (!value && value !== 0) return null;
  const text = String(value).trim();
  if (/\d+\s*h|\d+\s*(?:min|m)\b|\d{1,2}:\d{2}/i.test(text)) return text.replace(/\s+/g, ' ');
  const number = numberValue(value);
  if (number === null) return null;
  let minutes = number;
  if (number > 1440) minutes = Math.round(number / 60);
  else if (number > 0 && number <= 24) minutes = Math.round(number * 60);
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return `${hours} h ${String(rest).padStart(2, '0')}`;
}

function formatPace(value) {
  if (value == null || value === '') return null;
  const text = String(value).trim();
  if (/[/:']/i.test(text) || /km/i.test(text)) return text;
  const number = numberValue(value);
  if (number !== null && number >= 120 && number <= 900) {
    const minutes = Math.floor(number / 60);
    const seconds = Math.round(number % 60);
    return `${minutes}:${String(seconds).padStart(2, '0')} /km`;
  }
  return text;
}

function compactDate(value) {
  if (!value) return null;
  const text = String(value);
  const match = text.match(/(20\d{2})[-/]?(\d{2})[-/]?(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  const timestamp = numberValue(value);
  if (timestamp && timestamp > 1_000_000_000) {
    const ms = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
    return new Date(ms).toISOString().slice(0, 10);
  }
  return null;
}

function formatDuration(value) {
  if (value == null || value === '') return '—';
  const text = String(value).trim();
  if (/[:hms]/i.test(text)) return text;
  const number = numberValue(value);
  if (number === null) return text;
  const seconds = number > 300 ? Math.round(number) : Math.round(number * 60);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}` : `${minutes}:${String(rest).padStart(2, '0')}`;
}

function formatDistance(value) {
  if (value == null || value === '') return '—';
  const text = String(value).trim();
  if (/km|mi|m\b/i.test(text)) return text;
  const number = numberValue(value);
  if (number === null) return text;
  const km = number > 200 ? number / 1000 : number;
  return `${km.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} km`;
}

function firstActivityRef(raw) {
  const queue = [raw];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    const labelId = current.labelId ?? current.LabelId ?? current.labelID;
    const sportType = current.sportType ?? current.SportType ?? current.sportTypeCode;
    if (labelId != null && sportType != null) return { labelId: String(labelId), sportType: Number(sportType), source: current };
    queue.push(...Object.values(current).filter(value => value && typeof value === 'object'));
  }

  const text = flattenText(raw);
  const label = /Label\s*Id\s*[:=]\s*([A-Za-z0-9_-]+)/i.exec(text);
  if (!label) return null;
  const around = text.slice(Math.max(0, label.index - 180), label.index + 500);
  const sport = /Sport\s*Type(?:\s*Code)?\s*[:=]\s*(\d+)/i.exec(around);
  return sport ? { labelId: label[1], sportType: Number(sport[1]), source: around } : null;
}

function normalizeActivity(ref, detail) {
  if (!ref && !detail) return null;
  const source = detail || ref?.source || '';
  const listSource = ref?.source || '';
  const date = compactDate(findStructured(source, ['date', 'startDate', 'startTime', 'startTimestamp']) ||
    textValue(source, [], [/(?:Start\s*(?:Time|Date)|Date)\s*[:=]\s*([^\n|]+)/i]) ||
    textValue(listSource, [], [/(?:Start\s*(?:Time|Date)|Date)\s*[:=]\s*([^\n|]+)/i]));
  const sport = textValue(source,
    ['sportName', 'sportTypeName', 'activityName', 'name'],
    [/(?:Sport\s*Name|Activity\s*Name|Workout\s*Name)\s*[:=]\s*([^\n|]+)/i]) || 'Activité COROS';
  const distance = textValue(source,
    ['distanceKm', 'distance', 'totalDistance'],
    [/Distance\s*[:=]\s*([^\n|]+)/i]);
  const duration = textValue(source,
    ['duration', 'workoutTime', 'durationSeconds', 'durationMinutes'],
    [/(?:Duration|Workout\s*Time)\s*[:=]\s*([^\n|]+)/i]);
  const pace = textValue(source,
    ['averagePace', 'avgPace', 'pace'],
    [/(?:Average|Avg)\s*Pace\s*[:=]\s*([^\n|]+)/i, /Pace\s*[:=]\s*([^\n|]+)/i]);
  const avgHr = textNumber(source,
    ['avgHr', 'averageHeartRate', 'avgHeartRate'],
    [/(?:Average|Avg)\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]);
  const maxHr = textNumber(source,
    ['maxHr', 'maxHeartRate'],
    [/Max(?:imum)?\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]);
  const focus = textValue(source,
    ['trainingFocus', 'focus'],
    [/Training\s*Focus\s*[:=]\s*([^\n|]+)/i]) || 'COROS';
  return {
    id: ref?.labelId ? `coros-${ref.labelId}` : `coros-${Date.now()}`,
    labelId: ref?.labelId || null,
    sportType: ref?.sportType ?? null,
    date,
    sport,
    distance: formatDistance(distance),
    duration: formatDuration(duration),
    pace: formatPace(pace) || '—',
    avgHr,
    maxHr,
    trainingFocus: focus,
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

function addDays(dateIso, days) {
  const date = new Date(`${dateIso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function yyyymmdd(value) {
  return value.replaceAll('-', '');
}

function safeError(error) {
  return String(error?.message || error || 'Erreur').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]').slice(0, 180);
}

function shape(value) {
  if (typeof value === 'string') return `text:${value.length}`;
  if (Array.isArray(value)) return `array:${value.length}`;
  if (value && typeof value === 'object') return `object:${Object.keys(value).slice(0, 12).join(',')}`;
  return String(typeof value);
}

export async function syncCorosV2(request) {
  const access = await currentAccess(request);
  const today = localDateIso();
  const timezone = process.env.APP_TIMEZONE || 'Europe/Paris';
  const start = addDays(today, -7);

  const jobs = {
    recovery: ['queryRecoveryStatus', { timezone }],
    sleep: ['querySleepData', { days: 2, timezone }],
    load: ['queryTrainingLoadAssessment', { days: 7 }],
    fitness: ['queryFitnessAssessmentOverview', {}],
    activities: ['querySportRecords', { startDate: yyyymmdd(start), endDate: yyyymmdd(today), limit: 10, timezone }]
  };

  const entries = await Promise.all(Object.entries(jobs).map(async ([key, [name, args]]) => {
    try {
      return [key, await tool(access.accessToken, name, args, key === 'activities' ? 2 : 1), null];
    } catch (error) {
      return [key, null, safeError(error)];
    }
  }));
  const raw = Object.fromEntries(entries.map(([key, value]) => [key, value]));
  const errors = Object.fromEntries(entries.filter(([, , error]) => error).map(([key, , error]) => [key, error]));

  const recovery = textNumber(raw.recovery,
    ['recoveryPercentage', 'recoveryPercent', 'recoveryScore', 'recoveryRate', 'recovery'],
    [/(?:Recovery\s*(?:Percentage|Percent|Score|Rate)?|Recovery)\s*[:=]\s*(\d+(?:\.\d+)?)/i, /(?:récupération|recuperation)\s*[:=]?\s*(\d+(?:\.\d+)?)\s*%?/i]);
  const sleepScore = textNumber(raw.sleep,
    ['sleepScore', 'sleepQualityScore', 'score'],
    [/Sleep\s*Score\s*[:=]\s*(\d+(?:\.\d+)?)/i, /Score\s*(?:de\s*)?sommeil\s*[:=]\s*(\d+(?:\.\d+)?)/i]);
  const sleepDurationRaw = textValue(raw.sleep,
    ['mainSleepDuration', 'sleepDuration', 'totalSleepDuration', 'sleepMinutes', 'sleepTime'],
    [/(?:Main\s*)?Sleep\s*Duration\s*[:=]\s*([^\n|]+)/i, /Durée\s*(?:principale\s*)?du\s*sommeil\s*[:=]\s*([^\n|]+)/i]);
  const shortTermLoad = textNumber(raw.load,
    ['shortTermLoad', 'shortLoad', 'shortTermTrainingLoad', 'atl'],
    [/Short[-\s]*Term\s*Load\s*[:=]\s*(\d+(?:\.\d+)?)/i, /ATL\s*[:=]\s*(\d+(?:\.\d+)?)/i]);
  const longTermLoad = textNumber(raw.load,
    ['longTermLoad', 'longLoad', 'longTermTrainingLoad', 'ctl'],
    [/Long[-\s]*Term\s*Load\s*[:=]\s*(\d+(?:\.\d+)?)/i, /CTL\s*[:=]\s*(\d+(?:\.\d+)?)/i]);
  const loadRatio = textNumber(raw.load,
    ['loadRatio', 'trainingLoadRatio', 'ratio'],
    [/Load\s*Ratio\s*[:=]\s*(\d+(?:\.\d+)?)/i, /(?:ACWR|Ratio)\s*[:=]\s*(\d+(?:\.\d+)?)/i]);
  const vo2max = textNumber(raw.fitness,
    ['vo2max', 'vo2Max', 'runningVo2max'],
    [/(?:VO2\s*Max|VO₂max|VO2max)\s*[:=]\s*(\d+(?:\.\d+)?)/i]);
  const thresholdPaceRaw = textValue(raw.fitness,
    ['thresholdPace', 'lactateThresholdPace', 'ltPace'],
    [/(?:Threshold|Lactate\s*Threshold)\s*Pace\s*[:=]\s*([^\n|]+)/i]);
  const thresholdHr = textNumber(raw.fitness,
    ['thresholdHeartRate', 'lactateThresholdHeartRate', 'thresholdHr', 'ltHr'],
    [/(?:Threshold|Lactate\s*Threshold)\s*(?:Heart\s*Rate|HR)\s*[:=]\s*(\d+(?:\.\d+)?)/i]);
  const halfPrediction = textValue(raw.fitness,
    ['halfMarathon', 'halfMarathonPrediction', 'halfPrediction'],
    [/Half[-\s]*Marathon(?:\s*(?:Prediction|Time))?\s*[:=]\s*([^\n|]+)/i]);

  const activityRef = firstActivityRef(raw.activities);
  let activityDetail = null;
  if (activityRef?.labelId && Number.isFinite(activityRef.sportType)) {
    try {
      activityDetail = await tool(access.accessToken, 'getActivityDetail', {
        labelId: activityRef.labelId,
        sportType: activityRef.sportType
      }, 1);
    } catch (error) {
      errors.activityDetail = safeError(error);
    }
  }

  const cache = {
    version: 2,
    date: today,
    syncedAt: new Date().toISOString(),
    metrics: {
      recovery,
      sleepScore,
      sleepDuration: formatSleepDuration(sleepDurationRaw),
      shortTermLoad,
      longTermLoad,
      loadRatio,
      vo2max,
      thresholdPace: formatPace(thresholdPaceRaw),
      halfPrediction: halfPrediction || null
    },
    thresholdHr,
    latestActivity: normalizeActivity(activityRef, activityDetail),
    errors,
    diagnostics: Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, shape(value)]))
  };

  console.log('[COROS sync]', JSON.stringify({
    version: 2,
    diagnostics: cache.diagnostics,
    errorKeys: Object.keys(errors),
    detected: {
      recovery: recovery !== null,
      sleep: cache.metrics.sleepDuration !== null,
      shortTermLoad: shortTermLoad !== null,
      vo2max: vo2max !== null,
      activity: Boolean(cache.latestActivity)
    }
  }));

  return {
    cache,
    setCookies: [
      ...access.setCookies,
      cookie(CACHE_COOKIE, seal(cache), 60 * 60 * 24 * 7)
    ]
  };
}
