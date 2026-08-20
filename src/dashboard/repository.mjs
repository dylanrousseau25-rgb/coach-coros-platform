import { db } from '../db/pool.mjs';

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

export async function dashboardForUser(user) {
  const pool = db();

  const [[profileRows], [metricRows], [activityRows], [objectiveRows], [planRows], [sessionRows]] =
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
      )
    ]);

  const profile = profileRows[0] || {};
  const metric = metricRows[0] || null;
  const activeObjective = objectiveRows.find(x => x.status === 'active') || objectiveRows[0] || null;
  const activePlan = activeObjective
    ? planRows.find(x => x.objective_id === activeObjective.id) || planRows.find(x => x.status === 'active') || null
    : planRows.find(x => x.status === 'active') || planRows[0] || null;

  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: user.timezone || 'Europe/Paris',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  const activeSessions = activePlan ? sessionRows.filter(x => x.plan_id === activePlan.id) : [];
  const todaySession = activeSessions.find(x => String(x.scheduled_date).slice(0, 10) === today)
    || activeSessions.find(x => x.status === 'today')
    || null;

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
    metrics: metric ? {
      date: String(metric.metric_date).slice(0, 10),
      source: metric.provider,
      recovery: metric.recovery_score,
      sleepScore: metric.sleep_score,
      sleepDurationMinutes: metric.sleep_minutes,
      sleepHrv: metric.sleep_hrv,
      shortTermLoad: metric.short_term_load,
      longTermLoad: metric.long_term_load,
      loadRatio: metric.load_ratio,
      vo2max: metric.vo2max,
      thresholdHr: metric.threshold_hr,
      thresholdPace: metric.threshold_pace_text
    } : null,
    objectives: objectiveRows,
    activeObjective,
    activePlan: activePlan ? { ...activePlan, sessions: activeSessions } : null,
    todaySession,
    activities: activityRows,
    latestActivity: activityRows[0] || null,
    meta: {
      today,
      multiUser: true,
      persistence: 'mysql'
    }
  };
}
