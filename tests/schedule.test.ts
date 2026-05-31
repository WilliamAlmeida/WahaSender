import { describe, it, expect } from 'vitest';
import { isWithinSchedule, nextSendDelayMs } from '../server/lib/schedule';

describe('isWithinSchedule', () => {
  it('returns true when schedules empty (no restriction)', () => {
    expect(isWithinSchedule([], new Date('2025-01-01T10:00:00'))).toBe(true);
  });

  it('honours weekday + time window', () => {
    const wed = new Date('2025-01-01T10:30:00');
    const schedules = [{ dayOfWeek: wed.getDay(), slots: [{ start: '09:00', end: '12:00' }] }];
    expect(isWithinSchedule(schedules, wed)).toBe(true);
  });

  it('rejects outside window', () => {
    const wed = new Date('2025-01-01T20:00:00');
    const schedules = [{ dayOfWeek: wed.getDay(), slots: [{ start: '09:00', end: '12:00' }] }];
    expect(isWithinSchedule(schedules, wed)).toBe(false);
  });
});

describe('nextSendDelayMs', () => {
  it('returns value within [min, max] (in ms)', () => {
    for (let i = 0; i < 50; i++) {
      const ms = nextSendDelayMs(10, 20);
      expect(ms).toBeGreaterThanOrEqual(10_000);
      expect(ms).toBeLessThanOrEqual(20_000);
    }
  });
});
