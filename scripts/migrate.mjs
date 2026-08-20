import { migrate } from '../src/db/migrate.mjs';
import { closeDb } from '../src/db/pool.mjs';

try {
  await migrate();
  console.log('✓ base V5 à jour');
} finally {
  await closeDb();
}
