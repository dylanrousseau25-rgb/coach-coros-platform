import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const statePath = new URL('./data/state.json', import.meta.url);
const original = await readFile(statePath, 'utf8');
const port = 8798;
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: new URL('.', import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe']
});

const base = `http://127.0.0.1:${port}`;

async function waitForServer() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`${base}/api/dashboard`);
      if (r.ok) return;
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('Server did not start');
}

try {
  await waitForServer();
  const dashboard = await fetch(`${base}/api/dashboard`).then(r => r.json());
  assert.equal(dashboard.schemaVersion, 3);
  assert.equal(dashboard.activeObjective.id, 'obj-20k-2026');
  assert.equal(dashboard.heartRateZones.thresholdHr, 168);
  assert.equal(dashboard.todaySession.hrTarget, '< 151 bpm');

  const createdRes = await fetch(`${base}/api/objectives`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Semi test', sport: 'Course à pied', date: '2027-03-14', target: '< 1 h 50', sessionsPerWeek: 5 })
  });
  assert.equal(createdRes.status, 201);
  const created = await createdRes.json();
  assert.equal(created.objective.status, 'planned');
  assert.ok(created.plan.id);

  const activatedRes = await fetch(`${base}/api/objectives/${created.objective.id}/activate`, { method: 'POST' });
  assert.equal(activatedRes.status, 200);
  const dashboard2 = await fetch(`${base}/api/dashboard`).then(r => r.json());
  assert.equal(dashboard2.activeObjective.id, created.objective.id);
  assert.equal(dashboard2.activities[0].id, 'activity-20260818-run');
  assert.equal(dashboard2.heartRateZones.thresholdHr, 168);

  const html = await fetch(`${base}/`).then(r => r.text());
  assert.match(html, /Objectifs/);
  assert.match(html, /Ton contexte permanent/);

  console.log('✓ V3 dashboard');
  console.log('✓ création d’un nouvel objectif');
  console.log('✓ activation sans perte du profil / historique');
  console.log('✓ interface multi-objectifs servie');
} finally {
  server.kill('SIGTERM');
  await writeFile(statePath, original, 'utf8');
}
