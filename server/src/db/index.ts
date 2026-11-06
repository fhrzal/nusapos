import Database from 'better-sqlite3';
import { config } from '../config';
import { SCHEMA } from './schema';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function migrate() {
  db.exec(SCHEMA);
  // Kolom yang ditambahkan setelah versi awal (database lama dibuat tanpa kolom ini).
  ensureColumn('shifts', 'schedule_id', 'INTEGER REFERENCES shift_schedules(id)');
}

function ensureColumn(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/** Jalankan fungsi dalam satu transaksi database (rollback otomatis jika error). */
export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}

export type Row = Record<string, any>;

export const one = <T = Row>(sql: string, ...params: unknown[]) =>
  db.prepare(sql).get(...params) as T | undefined;

export const all = <T = Row>(sql: string, ...params: unknown[]) => db.prepare(sql).all(...params) as T[];

export const run = (sql: string, ...params: unknown[]) => db.prepare(sql).run(...params);

export const insert = (sql: string, ...params: unknown[]) => Number(db.prepare(sql).run(...params).lastInsertRowid);
