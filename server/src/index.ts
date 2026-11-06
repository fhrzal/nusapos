import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import compression from 'compression';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { config } from './config';
import { migrate, one, run } from './db';
import { HttpError, zodMessage } from './lib/http';
import { authenticate } from './middleware/auth';
import authRoutes from './routes/auth.routes';
import inventoryRoutes from './routes/inventory.routes';
import masterRoutes from './routes/master.routes';
import membersRoutes from './routes/members.routes';
import posRoutes from './routes/pos.routes';
import productsRoutes from './routes/products.routes';
import promotionsRoutes from './routes/promotions.routes';
import purchasingRoutes from './routes/purchasing.routes';
import reportsRoutes from './routes/reports.routes';
import salesRoutes from './routes/sales.routes';
import schedulesRoutes from './routes/schedules.routes';
import shiftsRoutes from './routes/shifts.routes';

migrate();

// Instalasi baru tanpa data demo: buat Super Admin dengan password acak agar sistem bisa diakses.
if (one<{ n: number }>('SELECT COUNT(*) n FROM users')!.n === 0) {
  const password = crypto.randomBytes(9).toString('base64url');
  run(
    `INSERT INTO users(employee_no, username, full_name, password_hash, role) VALUES ('ADMIN001', 'admin', 'Administrator', ?, 'SUPER_ADMIN')`,
    bcrypt.hashSync(password, 10),
  );
  console.warn(`\n⚠  Database kosong — akun awal dibuat:\n   username: admin\n   password: ${password}\n   Segera ganti password setelah login, atau jalankan "npm run seed" untuk data demo.\n`);
}

const app = express();
app.set('trust proxy', 'loopback');
// Server toko umumnya diakses via HTTP di jaringan LAN, jadi jangan paksa upgrade ke HTTPS.
app.use(
  helmet({
    contentSecurityPolicy: config.isProd ? { directives: { upgradeInsecureRequests: null } } : false,
    hsts: false,
  }),
);
app.use(compression());
if (!config.isProd) app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
app.use('/api/auth', authRoutes);

const api = express.Router();
api.use(authenticate);
api.use('/', masterRoutes);
api.use('/products', productsRoutes);
api.use('/members', membersRoutes);
api.use('/promotions', promotionsRoutes);
api.use('/pos', posRoutes);
api.use('/shifts', shiftsRoutes);
api.use('/schedules', schedulesRoutes);
api.use('/sales', salesRoutes);
api.use('/inventory', inventoryRoutes);
api.use('/purchase-orders', purchasingRoutes);
api.use('/reports', reportsRoutes);
app.use('/api', api);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint tidak ditemukan' }));

// Produksi: sajikan hasil build client dari server yang sama.
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist, { index: false, maxAge: '7d' }));
  app.get('*', (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
}

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) return res.status(400).json({ error: zodMessage(err) });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof SyntaxError && 'body' in err) return res.status(400).json({ error: 'Format JSON tidak valid' });
  const code = (err as { code?: string })?.code ?? '';
  if (code.startsWith('SQLITE_CONSTRAINT')) {
    const msg = String((err as Error).message);
    if (code === 'SQLITE_CONSTRAINT_UNIQUE' || msg.includes('UNIQUE')) {
      const field = msg.split('.').pop();
      return res.status(409).json({ error: `Data dengan ${field} yang sama sudah ada` });
    }
    return res.status(409).json({ error: 'Data tidak dapat disimpan karena masih terkait dengan data lain' });
  }
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: 'Terjadi kesalahan pada server' });
});

app.listen(config.port, () => {
  console.log(`NusaPOS API berjalan di http://localhost:${config.port} (${config.isProd ? 'production' : 'development'})`);
});
