import { config } from '../config';

export interface DaySchedule {
  dayOfWeek: number;
  slots: { start: string; end: string }[];
}

export function isWithinSchedule(schedules: DaySchedule[] | null | undefined, now: Date): boolean {
  if (!schedules || schedules.length === 0) return true;
  const day = now.getDay();
  const today = schedules.find((s) => s.dayOfWeek === day);
  if (!today || !today.slots || today.slots.length === 0) return false;
  const hh = now.getHours().toString().padStart(2, '0');
  const mm = now.getMinutes().toString().padStart(2, '0');
  const cur = `${hh}:${mm}`;
  return today.slots.some((slot) => cur >= slot.start && cur <= slot.end);
}

export function nextSendDelayMs(intervalMin: number, intervalMax: number): number {
  const min = Math.max(0, intervalMin || 0);
  const max = Math.max(min, intervalMax || min);
  const range = Math.floor((max - min) / 10) + 1;
  const secs = Math.floor(Math.random() * range) * 10 + min;
  return secs * 1000;
}

/** Tiny wrapper to read worker concurrency from env. */
export const WORKER_CONCURRENCY = config.WORKER_CONCURRENCY;
