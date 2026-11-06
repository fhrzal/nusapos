import { all, one } from '../db';
import { localDateTime } from './http';

/** Kasir boleh membuka shift paling cepat 30 menit sebelum jadwal mulai. */
export const EARLY_OPEN_MINUTES = 30;

export interface Schedule {
  id: number;
  store_id: number;
  terminal_id: number;
  user_id: number;
  start_at: string;
  end_at: string;
  note: string | null;
}

/** Jadwal user di terminal tertentu yang sedang berlangsung (atau segera dimulai). */
export function activeSchedule(userId: number, terminalId: number): Schedule | undefined {
  const now = new Date();
  return one<Schedule>(
    `SELECT * FROM shift_schedules WHERE user_id = ? AND terminal_id = ? AND start_at <= ? AND end_at > ?
     ORDER BY start_at LIMIT 1`,
    userId,
    terminalId,
    localDateTime(new Date(now.getTime() + EARLY_OPEN_MINUTES * 60_000)),
    localDateTime(now),
  );
}

export function upcomingSchedules(userId: number, limit = 5) {
  return all(
    `SELECT ss.id, ss.start_at, ss.end_at, ss.terminal_id, t.code AS terminal_code
     FROM shift_schedules ss JOIN terminals t ON t.id = ss.terminal_id
     WHERE ss.user_id = ? AND ss.end_at > ? ORDER BY ss.start_at LIMIT ?`,
    userId,
    localDateTime(),
    limit,
  );
}

/** "05/11 07:00–15:00" */
export const scheduleLabel = (start: string, end: string) => `${start.slice(8, 10)}/${start.slice(5, 7)} ${start.slice(11, 16)}–${end.slice(11, 16)}`;
