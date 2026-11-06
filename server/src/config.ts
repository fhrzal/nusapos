import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = process.env.DATA_DIR ?? path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });

// Secret JWT dibuat otomatis sekali lalu disimpan, kecuali diberikan lewat env.
function loadJwtSecret(): string {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const file = path.join(dataDir, '.jwt-secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(48).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

export const config = {
  port: Number(process.env.PORT ?? 4000),
  isProd: process.env.NODE_ENV === 'production',
  dbPath: process.env.DB_PATH ?? path.join(dataDir, 'pos.db'),
  jwtSecret: loadJwtSecret(),
  jwtExpiresIn: '12h',
  clientDist: path.resolve(root, '../client/dist'),
};
