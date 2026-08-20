import { db, closeDb } from '../src/db/pool.mjs';
import { hashPassword } from '../src/auth/password.mjs';

const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
const password = String(process.env.ADMIN_PASSWORD || '');
const displayName = String(process.env.ADMIN_NAME || 'Admin').trim();

if (!email || !password) {
  console.error('ADMIN_EMAIL et ADMIN_PASSWORD sont requis.');
  process.exitCode = 1;
} else {
  try {
    const passwordHash = await hashPassword(password);
    const initials = displayName.split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase() || '').join('');
    await db().execute(
      `INSERT INTO users
        (email, password_hash, display_name, initials, role, status)
       VALUES (?, ?, ?, ?, 'admin', 'active')
       ON DUPLICATE KEY UPDATE
         password_hash = VALUES(password_hash),
         display_name = VALUES(display_name),
         initials = VALUES(initials),
         role = 'admin',
         status = 'active'`,
      [email, passwordHash, displayName, initials]
    );
    console.log(`✓ admin prêt: ${email}`);
  } finally {
    await closeDb();
  }
}
