/* eslint-disable no-console */
/**
 * Admin CLI:
 *   npm run admin -- list-users
 *   npm run admin -- reset-password <email> <newPassword>
 *   npm run admin -- promote <email>
 *   npm run admin -- revoke-token <tokenId>
 */
import db from '../server/db';
import bcrypt from 'bcrypt';
import { runMigrations } from '../server/migrations';
import { validatePassword } from '../server/auth/password-policy';

async function main() {
  await runMigrations();
  const [, , cmd, ...rest] = process.argv;

  switch (cmd) {
    case 'list-users': {
      const rows = await db('users').select('id', 'email', 'name', 'role', 'claimable', 'createdAt', 'lastLoginAt');
      console.table(rows);
      break;
    }
    case 'reset-password': {
      const [email, newPassword] = rest;
      if (!email || !newPassword) {
        console.error('Usage: reset-password <email> <newPassword>');
        process.exit(1);
      }
      const policy = validatePassword(newPassword);
      if (!policy.ok) {
        console.error('Policy:', (policy as { reason: string }).reason);
        process.exit(1);
      }
      const row = await db('users').where({ email: email.toLowerCase() }).first();
      if (!row) {
        console.error('User not found');
        process.exit(1);
      }
      const passwordHash = await bcrypt.hash(newPassword, 12);
      await db('users').where({ id: row.id }).update({ passwordHash, claimable: false });
      console.log('Password reset for', email);
      break;
    }
    case 'promote': {
      const [email] = rest;
      if (!email) {
        console.error('Usage: promote <email>');
        process.exit(1);
      }
      const updated = await db('users').where({ email: email.toLowerCase() }).update({ role: 'admin' });
      console.log(updated ? 'Promoted to admin' : 'User not found');
      break;
    }
    case 'revoke-token': {
      const [tokenId] = rest;
      if (!tokenId) {
        console.error('Usage: revoke-token <tokenId>');
        process.exit(1);
      }
      const updated = await db('api_tokens').where({ id: tokenId }).update({ revokedAt: new Date() });
      console.log(updated ? 'Token revoked' : 'Token not found');
      break;
    }
    default:
      console.error('Unknown command. Available: list-users, reset-password, promote, revoke-token');
      process.exit(1);
  }
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
