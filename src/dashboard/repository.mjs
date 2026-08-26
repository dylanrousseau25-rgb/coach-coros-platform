import { db } from '../db/pool.mjs';
import { providerStatus } from '../providers/repository.mjs';

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function isoDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    const year = value.getUTCFullYear();
    const month = String(value.getUTCMonth() + 1).padStart(2, '0');
    const day = String(value.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

function sleepDuration(minutes) {
  if (minutes == null) return null;
  const total = Number(minutes);
  if (!Number.isFinite(total)) return null;
  const hours = Math.floor(total / 60);
  const rest = Math.round(total % 60);
  return hours ? `${hours} h ${String(rest).padStart(2, '0')}` : `${rest} min`;
}

function mapObjective(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    title: row.title,
    sport: row.sport,
    type: row.objective_type,
    eventName: row.event_name,
    date: isoDate(row.event_date),
    target: row.target,
    targetPace: row.target_pace,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

function mapSession(row) {
  return {
    id: String(row.id),
    planId: String(row.plan_id),
    date: isoDate(row.scheduled_date),
    day: row.day_label,
    sport: row.sport,
    title: row.title,
    duration: row.duration_text || '—',
    details: row.details,
    status: row.status,
    zone: row.zone,
    zoneLabel: row.zone_label,
    hrTarget: row.hr_target,
    rpeTarget: row.rpe_target,
    paceTarget: row.pace_target,
    source: row.source
  };
}

function mapPlan(row, sessions) {
  if (!row) return null;
  return {
    id: String(row.id),
    objectiveId: row.objective_id == null ? null : String(row.objective_id),
    name: row.name,
    status: row.status,
    phase: row.phase,
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    currentWeek: row.current_week,
    totalWeeks: row.total_weeks,
    principle: row.principle,
    sessions
  };
}

function mapActivity(row) {
  return {
    id: String(row.id),
    provider: row.provider,
    providerActivityId: row.provider_activity_id,
    date: isoDate(row.activity_date),
    startedAt: row.started_at,
    sport: row.sport,
    title: row.title,
    duration: row.duration_text,
    distance: row.distance_text,
    pace: row.pace_text,
    elevation: row.elevation_m == null ? null : `${row.elevation_m} m D+`,
    avgHr: row.avg_hr,
    maxHr: row.max_hr,
    cadence: row.cadence,
    trainingLoad: row.training_load,
    trainingFocus: row.training_focus,
    source: row.provider?.toUpperCase(),
    coachNote: row.coach_note
  };
}

function mapMetrics(row) {
  if (!row) return null;
  return {
    date: isoDate(row.metric_date),
    source: row.provider,
    recovery: row.recovery_score,
    sleepScore: row.sleep_score,
    sleepDuration: sleepDuration(row.sleep_minutes),
    sleepDurationMinutes: row.sleep_minutes,
    sleepHrv: row.sleep_hrv,
    restingHr: row.resting_hr,
    shortTermLoad: row.short_term_load,
    longTermLoad: row.long_term_load,
    loadRatio: row.load_ratio,
    vo2max: row.vo2max,
    thresholdHr: row.threshold_hr,
    thresholdPace: row.threshold_pace_text,
    syncedAt: row.synced_at
  };
}

function daysToDate(today, targetDate) {
  if (!targetDate) return null;
  const a = new Date(`${today}T00:00:00Z`);
  const b = new Date(`${targetDate}T00:00:00Z`);
  return Math.max(0, Math.ceil((b - a) / 86400000));
}

export async function dashboardForUser(user) {
  const pool = db();

  const [[profileRows], [metricRows], [activityRows], [objectiveRows], [planRows], [sessionRows], providers] =
    await Promise.all([
      pool.execute(
        `SELECT approach, availability, injury_notes, sports_json,
                weekly_constraints_json, heart_rate_zones_json
         FROM athlete_profiles WHERE user_id = ? LIMIT 1`,
        [user.id]
      ),
      pool.execute(
        `SELECT * FROM daily_metrics
         WHERE user_id = ?
         ORDER BY metric_date DESC, id DESC
         LIMIT 1`,
        [user.id]
      ),
      pool.execute(
        `SELECT * FROM activities
         WHERE user_id = ?
         ORDER BY activity_date DESC, id DESC
         LIMIT 20`,
        [user.id]
      ),
      pool.execute(
        `SELECT * FROM objectives
         WHERE user_id = ?
         ORDER BY FIELD(status, 'active','planned','completed','cancelled'), event_date IS NULL, event_date`,
        [user.id]
      ),
      pool.execute(
        `SELECT * FROM training_plans
         WHERE user_id = ?
         ORDER BY FIELD(status, 'active','draft','paused','completed','cancelled'), id DESC`,
        [user.id]
      ),
      pool.execute(
        `SELECT ps.*
         FROM plan_sessions ps
         JOIN training_plans tp ON tp.id = ps.plan_id
         WHERE ps.user_id = ? AND tp.user_id = ?
         ORDER BY ps.scheduled_date, ps.id`,
        [user.id, user.id]
      ),
      providerStatus(user.id)
    ]);

  const profile = profileRows[0] || {};
  const metric = mapMetrics(metricRows[0] || null);
  const objectives = objectiveRows.map(mapObjective);
  const activeObjectiveRow = objectiveRows.find(row => row.status === 'active') || null;
  const activeObjective = mapObjective(activeObjectiveRow);
  const activePlanRow = activeObjectiveRow
    ? planRows.find(row => row.objective_id === activeObjectiveRow.id && row.status === 'active')
      || planRows.find(row => row.objective_id === activeObjectiveRow.id)
      || null
    : planRows.find(row => row.status === 'active') || null;

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: user.timezone || 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  const activeSessionRows = activePlanRow ? sessionRows.filter(row => row.plan_id === activePlanRow.id) : [];
  const activeSessions = activeSessionRows.map(mapSession);
  const todaySession = activeSessions.find(session => session.date === today) || null;
  const activePlan = mapPlan(activePlanRow, activeSessions);
  const activities = activityRows.map(mapActivity);
  const corosConnection = providers.find(item => item.provider === 'coros') || null;
  const metricDate = metric?.date || null;

  return {
    user,
    athlete: {
      approach: profile.approach || null,
      availability: profile.availability || null,
      injuryNotes: profile.injury_notes || null,
      sports: parseJson(profile.sports_json, []),
      weeklyConstraints: parseJson(profile.weekly_constraints_json, {})
    },
    heartRateZones: parseJson(profile.heart_rate_zones_json, {}),
    metrics: metric,
    objectives,
    activeObjective,
    activePlan,
    todaySession,
    activities,
    latestActivity: activities[0] || null,
    providers,
    meta: {
      today,
      daysToObjective: daysToDate(today, activeObjective?.date),
      multiUser: true,
      persistence: 'mysql',
      metricsDate: metricDate,
      metricsFresh: metricDate === today,
      corosMode: corosConnection?.status === 'connected' ? 'connected' : 'disconnected',
      openAiMode: process.env.OPENAI_API_KEY ? 'connected' : 'demo'
    }
  };
}
