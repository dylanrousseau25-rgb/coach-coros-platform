import { readFile } from 'node:fs/promises';
import { db, closeDb, withTransaction } from '../src/db/pool.mjs';

const email = String(process.env.MIGRATION_USER_EMAIL || process.env.ADMIN_EMAIL || '').trim().toLowerCase();
if (!email) {
  console.error('MIGRATION_USER_EMAIL (ou ADMIN_EMAIL) est requis.');
  process.exit(1);
}

function parseDurationSeconds(text) {
  if (!text) return null;
  const hms = String(text).match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (hms) return Number(hms[1] || 0) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
  return null;
}

function parseMetricMinutes(text) {
  if (!text) return null;
  const h = String(text).match(/(\d+)\s*h/i);
  const m = String(text).match(/(\d+)\s*(?:min|m)\b/i);
  const minutes = Number(h?.[1] || 0) * 60 + Number(m?.[1] || 0);
  return minutes || null;
}

function parseDistanceM(text) {
  const match = String(text || '').replace(',', '.').match(/([\d.]+)\s*km/i);
  return match ? Math.round(Number(match[1]) * 1000) : null;
}

function parseElevationM(text) {
  const match = String(text || '').replace(',', '.').match(/([\d.]+)\s*m/i);
  return match ? Number(match[1]) : null;
}

function mysqlDateTime(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

const state = JSON.parse(await readFile(new URL('../data/state.json', import.meta.url), 'utf8'));

try {
  const [users] = await db().execute('SELECT id FROM users WHERE email = ? AND status = ? LIMIT 1', [email, 'active']);
  if (!users.length) throw new Error(`Utilisateur actif introuvable: ${email}`);
  const userId = users[0].id;

  await withTransaction(async connection => {
    await connection.execute(
      `INSERT INTO athlete_profiles
        (user_id, approach, availability, injury_notes, sports_json, weekly_constraints_json, heart_rate_zones_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         approach = VALUES(approach),
         availability = VALUES(availability),
         injury_notes = VALUES(injury_notes),
         sports_json = VALUES(sports_json),
         weekly_constraints_json = VALUES(weekly_constraints_json),
         heart_rate_zones_json = VALUES(heart_rate_zones_json)`,
      [
        userId,
        state.athlete?.approach || null,
        state.athlete?.availability || null,
        state.athlete?.injuryNotes || null,
        JSON.stringify(state.athlete?.sports || []),
        JSON.stringify(state.athlete?.weeklyConstraints || {}),
        JSON.stringify(state.heartRateZones || {})
      ]
    );

    const metricDate =
      state.plans?.flatMap(plan => plan.sessions || []).find(session => session.status === 'today')?.date ||
      state.plans?.find(plan => plan.status === 'active')?.startDate ||
      new Date().toISOString().slice(0, 10);

    await connection.execute(
      `INSERT INTO daily_metrics
        (user_id, provider, metric_date, recovery_score, sleep_score, sleep_minutes,
         short_term_load, long_term_load, load_ratio, vo2max, threshold_hr,
         threshold_pace_text, raw_data_json, synced_at)
       VALUES (?, 'legacy', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         recovery_score = VALUES(recovery_score),
         sleep_score = VALUES(sleep_score),
         sleep_minutes = VALUES(sleep_minutes),
         short_term_load = VALUES(short_term_load),
         long_term_load = VALUES(long_term_load),
         load_ratio = VALUES(load_ratio),
         vo2max = VALUES(vo2max),
         threshold_hr = VALUES(threshold_hr),
         threshold_pace_text = VALUES(threshold_pace_text),
         raw_data_json = VALUES(raw_data_json)`,
      [
        userId,
        metricDate,
        state.metrics?.recovery ?? null,
        state.metrics?.sleepScore ?? null,
        parseMetricMinutes(state.metrics?.sleepDuration),
        state.metrics?.shortTermLoad ?? null,
        state.metrics?.longTermLoad ?? null,
        state.metrics?.loadRatio ?? null,
        state.metrics?.vo2max ?? null,
        state.heartRateZones?.thresholdHr ?? null,
        state.metrics?.thresholdPace ?? null,
        JSON.stringify(state.metrics || {}),
        new Date()
      ]
    );

    for (const activity of state.activities || []) {
      await connection.execute(
        `INSERT INTO activities
          (user_id, provider, provider_activity_id, activity_date, sport, title,
           duration_seconds, duration_text, distance_m, distance_text, pace_text,
           elevation_m, avg_hr, max_hr, cadence, training_load, training_focus,
           coach_note, raw_summary_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           sport = VALUES(sport),
           duration_seconds = VALUES(duration_seconds),
           duration_text = VALUES(duration_text),
           distance_m = VALUES(distance_m),
           distance_text = VALUES(distance_text),
           pace_text = VALUES(pace_text),
           elevation_m = VALUES(elevation_m),
           avg_hr = VALUES(avg_hr),
           max_hr = VALUES(max_hr),
           cadence = VALUES(cadence),
           training_load = VALUES(training_load),
           training_focus = VALUES(training_focus),
           coach_note = VALUES(coach_note),
           raw_summary_json = VALUES(raw_summary_json)`,
        [
          userId,
          String(activity.source || 'legacy').toLowerCase(),
          activity.id,
          activity.date,
          activity.sport || 'Activité',
          activity.title || null,
          parseDurationSeconds(activity.duration),
          activity.duration || null,
          parseDistanceM(activity.distance),
          activity.distance || null,
          activity.pace || null,
          parseElevationM(activity.elevation),
          activity.avgHr ?? null,
          activity.maxHr ?? null,
          activity.cadence ?? null,
          activity.trainingLoad ?? null,
          activity.trainingFocus || null,
          activity.coachNote || null,
          JSON.stringify(activity)
        ]
      );
    }

    const objectiveIds = new Map();
    for (const objective of state.objectives || []) {
      await connection.execute(
        `INSERT INTO objectives
          (user_id, legacy_id, title, sport, objective_type, event_name, event_date,
           target, target_pace, status, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           title = VALUES(title),
           sport = VALUES(sport),
           objective_type = VALUES(objective_type),
           event_name = VALUES(event_name),
           event_date = VALUES(event_date),
           target = VALUES(target),
           target_pace = VALUES(target_pace),
           status = VALUES(status),
           completed_at = VALUES(completed_at)`,
        [
          userId,
          objective.id,
          objective.title,
          objective.sport,
          objective.type || null,
          objective.eventName || null,
          objective.date || null,
          objective.target || null,
          objective.targetPace || null,
          ['planned','active','completed','cancelled'].includes(objective.status) ? objective.status : 'planned',
          mysqlDateTime(objective.createdAt) || new Date(),
          mysqlDateTime(objective.completedAt)
        ]
      );
      const [rows] = await connection.execute(
        'SELECT id FROM objectives WHERE user_id = ? AND legacy_id = ? LIMIT 1',
        [userId, objective.id]
      );
      objectiveIds.set(objective.id, rows[0]?.id);
    }

    for (const plan of state.plans || []) {
      const objectiveDbId = objectiveIds.get(plan.objectiveId) || null;
      await connection.execute(
        `INSERT INTO training_plans
          (user_id, objective_id, legacy_id, name, status, phase, start_date, end_date,
           current_week, total_weeks, principle)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           objective_id = VALUES(objective_id),
           name = VALUES(name),
           status = VALUES(status),
           phase = VALUES(phase),
           start_date = VALUES(start_date),
           end_date = VALUES(end_date),
           current_week = VALUES(current_week),
           total_weeks = VALUES(total_weeks),
           principle = VALUES(principle)`,
        [
          userId,
          objectiveDbId,
          plan.id,
          plan.name || 'Plan',
          ['draft','active','paused','completed','cancelled'].includes(plan.status) ? plan.status : 'draft',
          plan.phase || null,
          plan.startDate || null,
          plan.endDate || null,
          plan.currentWeek ?? null,
          plan.totalWeeks ?? null,
          plan.principle || null
        ]
      );
      const [planRows] = await connection.execute(
        'SELECT id FROM training_plans WHERE user_id = ? AND legacy_id = ? LIMIT 1',
        [userId, plan.id]
      );
      const planDbId = planRows[0].id;

      for (const session of plan.sessions || []) {
        await connection.execute(
          `INSERT INTO plan_sessions
            (user_id, plan_id, legacy_id, scheduled_date, day_label, sport, title,
             duration_text, details, status, zone, zone_label, hr_target, rpe_target,
             pace_target, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'legacy')
           ON DUPLICATE KEY UPDATE
             plan_id = VALUES(plan_id),
             scheduled_date = VALUES(scheduled_date),
             day_label = VALUES(day_label),
             sport = VALUES(sport),
             title = VALUES(title),
             duration_text = VALUES(duration_text),
             details = VALUES(details),
             status = VALUES(status),
             zone = VALUES(zone),
             zone_label = VALUES(zone_label),
             hr_target = VALUES(hr_target),
             rpe_target = VALUES(rpe_target),
             pace_target = VALUES(pace_target)`,
          [
            userId,
            planDbId,
            session.id,
            session.date,
            session.day || null,
            session.sport || 'Sport',
            session.title || 'Séance',
            session.duration || null,
            session.details || null,
            ['planned','today','completed','skipped','replaced'].includes(session.status) ? session.status : 'planned',
            session.zone ?? null,
            session.zoneLabel || null,
            session.hrTarget || null,
            session.rpeTarget || null,
            session.paceTarget || null
          ]
        );
      }
    }

    if ((state.coachMessages || []).length) {
      const [threadResult] = await connection.execute(
        `INSERT INTO coach_threads (user_id, title) VALUES (?, 'Historique V4 importé')`,
        [userId]
      );
      const threadId = threadResult.insertId;
      for (const message of [...state.coachMessages].reverse()) {
        await connection.execute(
          `INSERT INTO coach_messages
            (thread_id, user_id, role, content, model, created_at)
           VALUES (?, ?, 'assistant', ?, 'legacy-v4', ?)`,
          [threadId, userId, message.text, mysqlDateTime(message.at) || new Date()]
        );
      }
    }

    console.log(`✓ migration V4 → V5 prête pour user_id=${userId}`);
  });
} finally {
  await closeDb();
}
