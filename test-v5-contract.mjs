import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');

const [dashboard, apiRoutes, server, client] = await Promise.all([
  read('./src/dashboard/repository.mjs'),
  read('./src/api/routes.mjs'),
  read('./src/v5-server.mjs'),
  read('./public/v5-app.js')
]);

assert.match(dashboard, /metricsFresh:\s*metricDate === today/, 'Le dashboard doit marquer explicitement la fraîcheur des métriques.');
assert.doesNotMatch(dashboard, /find\([^\n]+status === ['"]today['"]/, 'Une séance ne doit jamais être choisie seulement avec status=today.');
assert.match(dashboard, /session\.date === today/, 'La séance du jour doit correspondre à la date du jour.');
assert.match(client, /meta\?\.metricsFresh/, 'Le client doit respecter metricsFresh.');
assert.match(client, /\/api\/v5\/dashboard/, 'Le client V5 doit appeler le dashboard V5.');
assert.doesNotMatch(client, /fetch\(['"]\/api\/dashboard/, 'Le client V5 ne doit pas appeler le dashboard V4.');
assert.match(apiRoutes, /WHERE id = \? AND user_id = \?/, 'Les mutations par identifiant doivent être bornées par user_id.');
assert.match(apiRoutes, /ps\.user_id = \?/, 'La complétion de séance doit vérifier user_id.');
assert.match(apiRoutes, /coach_threads WHERE id = \? AND user_id = \?/, 'Un thread Coach doit être isolé par user_id.');
assert.match(server, /pathname === '\/app\.js'[\s\S]+?\/v5-app\.js/, 'Le serveur V5 doit servir le client V5 à la place du client V4.');

console.log('✓ fraîcheur des métriques V5');
console.log('✓ séance du jour strictement datée');
console.log('✓ client branché sur /api/v5');
console.log('✓ mutations isolées par user_id');
console.log('✓ client V5 servi par le serveur V5');
