import { db, closeDb } from '../src/db/pool.mjs';
import { newInviteCode, hashInviteCode } from '../src/auth/tokens.mjs';

const maxUses = Math.max(1, Number(process.argv[2] || 1));
const days = Math.max(1, Number(process.argv[3] || 14));
const code = newInviteCode();
const codeHash = hashInviteCode(code);
const expiresAt = new Date(Date.now() + days * 86400000);

try {
  await db().execute(
    `INSERT INTO invite_codes (code_hash, max_uses, expires_at)
     VALUES (?, ?, ?)`,
    [codeHash, maxUses, expiresAt]
  );
  console.log('Code d’invitation (affiché une seule fois) :');
  console.log(code);
  console.log(`Valable ${days} jours · ${maxUses} utilisation(s)`);
} finally {
  await closeDb();
}
