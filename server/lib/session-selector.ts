import db from '../db';
import { isOpen } from './circuit-breaker';

interface SessionPick {
  session: string;
  fallbackUsed: boolean;
  tried: string[];
}

/**
 * Picks the next WAHA session to use for a campaign, honoring the campaign's
 * `distributionMethod` but skipping any session whose circuit breaker is
 * currently open. Returns null when no session is usable.
 */
export async function pickHealthySession(
  userId: string,
  sessions: string[],
  distributionMethod: string,
  sentCount: number,
): Promise<SessionPick | null> {
  if (!sessions.length) return null;
  const order =
    distributionMethod === 'round_robin'
      ? rotate(sessions, sentCount % sessions.length)
      : shuffle(sessions);

  const tried: string[] = [];
  for (const s of order) {
    tried.push(s);
    // eslint-disable-next-line no-await-in-loop
    const open = await isOpen(userId, s);
    if (!open) {
      return { session: s, fallbackUsed: s !== order[0], tried };
    }
  }
  return null;
}

function rotate<T>(arr: T[], n: number): T[] {
  return arr.slice(n).concat(arr.slice(0, n));
}

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Quickly reads sessions JSON column on a campaign row. */
export async function getCampaignSessions(campaignId: string): Promise<string[]> {
  const row = await db('campaigns').where({ id: campaignId }).first();
  if (!row) return [];
  try {
    return JSON.parse(row.sessions || '[]');
  } catch {
    return [];
  }
}
