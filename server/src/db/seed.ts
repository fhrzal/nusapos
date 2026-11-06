// Data demo: 4 toko, ±120 produk, member, promo, dan riwayat transaksi 30 hari terakhir.
// Jalankan: npm run seed  (database lama akan DIHAPUS)
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import { makeEan13 } from '../../../shared/barcode';
import { pointsEarned, priceLine, summarize, type PromoRule } from '../../../shared/pricing';
import type { Role } from '../../../shared/types';
import { config } from '../config';

for (const f of [config.dbPath, `${config.dbPath}-wal`, `${config.dbPath}-shm`]) fs.rmSync(f, { force: true });

const { db, migrate, insert, run, all } = await import('./index');
const { DEFAULT_SETTINGS } = await import('../lib/settings');
const { toPromoRule } = await import('../lib/promos');
const { addDays, localDate, localDateTime, pad } = await import('../lib/http');

migrate();

// PRNG deterministik agar data demo selalu sama.
let seedState = 20261102;
function rand() {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const randInt = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min;
const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
function weightedPick<T>(items: T[], weight: (t: T) => number): T {
  const total = items.reduce((s, i) => s + weight(i), 0);
  let r = rand() * total;
  for (const i of items) if ((r -= weight(i)) <= 0) return i;
  return items[items.length - 1];
}

const hashCache = new Map<string, string>();
const hash = (s: string) => {
  if (!hashCache.has(s)) hashCache.set(s, bcrypt.hashSync(s, 10));
  return hashCache.get(s)!;
};

console.log('• Pengaturan, toko, terminal, pengguna');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) run('INSERT INTO settings(key, value) VALUES (?, ?)', k, v);

const STORES = [
  { code: 'JKT01', name: 'NusaMart Kemang Raya', type: 'SUPERMARKET', address: 'Jl. Kemang Raya No. 18, Mampang Prapatan', city: 'Jakarta Selatan', phone: '021-7190018', terminals: 3, traffic: 70 },
  { code: 'JKT02', name: 'NusaMart Kelapa Gading', type: 'MINIMARKET', address: 'Jl. Boulevard Raya Blok QA2 No. 9, Kelapa Gading', city: 'Jakarta Utara', phone: '021-4530922', terminals: 2, traffic: 45 },
  { code: 'BDG01', name: 'NusaMart Dago', type: 'SUPERMARKET', address: 'Jl. Ir. H. Juanda No. 120, Coblong', city: 'Bandung', phone: '022-2503120', terminals: 3, traffic: 60 },
  { code: 'SBY01', name: 'NusaMart Hyper Tunjungan', type: 'HYPERMARKET', address: 'Jl. Basuki Rahmat No. 8-12, Genteng', city: 'Surabaya', phone: '031-5470812', terminals: 4, traffic: 105 },
];

// Slot jadwal kasir per toko (jam desimal sejak 00:00; >24 = hari berikutnya). JKT01 buka 24 jam.
const DEFAULT_SLOTS = [
  { from: 7, to: 15 },
  { from: 15, to: 23 },
];
const SLOTS: Record<string, { from: number; to: number }[]> = {
  JKT01: [...DEFAULT_SLOTS, { from: 23, to: 31 }],
};

const FIRST = ['Budi', 'Siti', 'Andi', 'Dewi', 'Rina', 'Agus', 'Putri', 'Rizky', 'Wahyu', 'Fitri', 'Dimas', 'Ayu', 'Yoga', 'Nadia', 'Hendra', 'Lestari', 'Fajar', 'Indah', 'Bayu', 'Maya', 'Arif', 'Citra', 'Eko', 'Sari', 'Teguh', 'Ratna', 'Joko', 'Wulan', 'Galih', 'Nurul', 'Ilham', 'Mega', 'Reza', 'Anisa', 'Hadi', 'Kartika'];
const LAST = ['Santoso', 'Wijaya', 'Pratama', 'Lestari', 'Saputra', 'Hidayat', 'Kusuma', 'Nugroho', 'Permata', 'Setiawan', 'Rahmawati', 'Gunawan', 'Siregar', 'Hutapea', 'Wibowo', 'Purnama', 'Halim', 'Susanto', 'Maharani', 'Firmansyah'];
const personName = () => `${pick(FIRST)} ${pick(LAST)}`;

let empSeq = 1;
const employeeNo = () => `NRS${pad(empSeq++, 5)}`;
function addUser(username: string, role: Role, storeId: number | null, password: string, pin?: string, name = personName()) {
  return insert(
    'INSERT INTO users(employee_no, username, full_name, password_hash, pin_hash, role, store_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    employeeNo(),
    username,
    name,
    hash(password),
    pin ? hash(pin) : null,
    role,
    storeId,
  );
}

addUser('admin', 'SUPER_ADMIN', null, 'admin123', '123456', 'Administrator Sistem');
addUser('hq', 'HQ_ADMIN', null, 'hq123456', '123456', 'Anita Kusumawardani');

interface SeedStore {
  id: number;
  code: string;
  type: string;
  traffic: number;
  terminals: { id: number; code: string }[];
  cashiers: number[];
  manager: number;
}
const stores: SeedStore[] = [];
for (const s of STORES) {
  const id = insert('INSERT INTO stores(code, name, type, address, city, phone) VALUES (?, ?, ?, ?, ?, ?)', s.code, s.name, s.type, s.address, s.city, s.phone);
  const terminals = Array.from({ length: s.terminals }, (_, i) => {
    const code = `POS-${pad(i + 1)}`;
    return { id: insert('INSERT INTO terminals(store_id, code, name) VALUES (?, ?, ?)', id, code, `Kasir ${i + 1}`), code };
  });
  const lc = s.code.toLowerCase();
  const manager = addUser(`manager.${lc}`, 'STORE_MANAGER', id, 'password', '123456');
  const spv = addUser(`spv.${lc}`, 'SUPERVISOR', id, 'password', '123456');
  addUser(`gudang.${lc}`, 'INVENTORY', id, 'password');
  const cashiers = Array.from({ length: s.terminals + 1 }, (_, i) => addUser(`kasir${i + 1}.${lc}`, 'CASHIER', id, 'password'));
  stores.push({ id, code: s.code, type: s.type, traffic: s.traffic, terminals, cashiers: [...cashiers, spv], manager });
}

console.log('• Kategori, supplier, produk');
const CATEGORIES: [string, string][] = [
  ['SNK', 'Makanan Ringan'], ['MNM', 'Minuman'], ['SMB', 'Sembako'], ['SUS', 'Susu & Olahan'], ['MIE', 'Mie & Pasta'],
  ['BUM', 'Bumbu Dapur'], ['PRD', 'Perawatan Diri'], ['KBR', 'Kebersihan Rumah'], ['BYI', 'Kebutuhan Bayi'],
  ['BSY', 'Buah & Sayur'], ['DGI', 'Daging & Ikan'], ['ROT', 'Roti & Kue'], ['FRZ', 'Makanan Beku'],
  ['KSH', 'Obat & Kesehatan'], ['ATK', 'Alat Tulis & Elektrik'],
];
const catId = new Map(CATEGORIES.map(([code, name]) => [code, insert('INSERT INTO categories(code, name) VALUES (?, ?)', code, name)]));

const SUPPLIERS: [string, string, string, string][] = [
  ['SUP001', 'PT Sinar Distribusi Pangan', 'Hendro Wijaya', '021-4602211'],
  ['SUP002', 'PT Mitra Boga Nusantara', 'Lina Marlina', '021-5308870'],
  ['SUP003', 'CV Segar Tani Lestari', 'Ujang Supriatna', '022-7810033'],
  ['SUP004', 'PT Cahaya Kimia Rumah Tangga', 'Robert Tanoto', '021-6909145'],
  ['SUP005', 'PT Prima Minuman Indonesia', 'Dian Paramitha', '021-8990120'],
  ['SUP006', 'PT Sentosa Farma Distribusi', 'apt. Yuliana', '031-5021777'],
  ['SUP007', 'PT Bahari Protein Mandiri', 'Samsul Arifin', '031-3550918'],
  ['SUP008', 'PT Karya Ilmu Stationery', 'Teddy Halim', '021-6250044'],
];
const supId = new Map(
  SUPPLIERS.map(([code, name, cp, phone]) => [
    code,
    insert(
      'INSERT INTO suppliers(code, name, contact_person, phone, email, address, payment_terms) VALUES (?, ?, ?, ?, ?, ?, ?)',
      code,
      name,
      cp,
      phone,
      `order@${name.toLowerCase().replace(/^(pt|cv) /, '').replace(/[^a-z]/g, '')}.co.id`,
      'Kawasan Industri Pulogadung, Jakarta Timur',
      pick([14, 30, 30, 45]),
    ),
  ]),
);

// [kategori, supplier, nama, merek, harga, satuan, popularitas 1-10, opsi]
type P = [string, string, string, string, number, string, number, { nonPpn?: boolean; plu?: string }?];
const PRODUCTS: P[] = [
  ['SNK', 'SUP001', 'Chitato Sapi Panggang 68g', 'Chitato', 11900, 'PCS', 6],
  ['SNK', 'SUP001', 'Qtela Singkong Balado 185g', 'Qtela', 15500, 'PCS', 4],
  ['SNK', 'SUP001', 'Taro Net Seaweed 65g', 'Taro', 8900, 'PCS', 4],
  ['SNK', 'SUP001', 'Oreo Vanilla 133g', 'Oreo', 9500, 'PCS', 6],
  ['SNK', 'SUP001', 'Good Time Chocochips 72g', 'Good Time', 7900, 'PCS', 4],
  ['SNK', 'SUP001', 'Roma Kelapa 300g', 'Roma', 10900, 'PCS', 5],
  ['SNK', 'SUP001', 'Tango Wafer Coklat 130g', 'Tango', 8500, 'PCS', 5],
  ['SNK', 'SUP001', 'Beng-Beng 20g', 'Beng-Beng', 2500, 'PCS', 7],
  ['SNK', 'SUP001', 'SilverQueen Almond 58g', 'SilverQueen', 16900, 'PCS', 4],
  ['SNK', 'SUP001', 'Pocky Chocolate 45g', 'Pocky', 9900, 'PCS', 3],
  ['SNK', 'SUP001', 'Kacang Garuda Kulit 200g', 'Garuda', 14900, 'PCS', 3],
  ['SNK', 'SUP001', 'Biskuat Original 134g', 'Biskuat', 6500, 'PCS', 4],
  ['MNM', 'SUP005', 'Aqua Air Mineral 600ml', 'Aqua', 3900, 'BTL', 10],
  ['MNM', 'SUP005', 'Aqua Air Mineral 1500ml', 'Aqua', 6500, 'BTL', 7],
  ['MNM', 'SUP005', 'Le Minerale 600ml', 'Le Minerale', 3700, 'BTL', 8],
  ['MNM', 'SUP005', 'Teh Botol Sosro Kotak 250ml', 'Sosro', 3900, 'PCS', 7],
  ['MNM', 'SUP005', 'Teh Pucuk Harum 350ml', 'Teh Pucuk', 4000, 'BTL', 8],
  ['MNM', 'SUP005', 'Coca-Cola 390ml', 'Coca-Cola', 6500, 'BTL', 5],
  ['MNM', 'SUP005', 'Sprite 390ml', 'Sprite', 6500, 'BTL', 4],
  ['MNM', 'SUP005', 'Pocari Sweat 500ml', 'Pocari Sweat', 8500, 'BTL', 5],
  ['MNM', 'SUP005', 'Good Day Cappuccino 250ml', 'Good Day', 7500, 'BTL', 5],
  ['MNM', 'SUP005', 'Nescafe Classic 100g', 'Nescafe', 32900, 'PCS', 3],
  ['MNM', 'SUP005', 'Kapal Api Special 165g', 'Kapal Api', 14500, 'PCS', 5],
  ['MNM', 'SUP005', 'Sariwangi Teh Celup 25s', 'Sariwangi', 8900, 'BOX', 4],
  ['MNM', 'SUP005', 'Floridina Orange 350ml', 'Floridina', 3900, 'BTL', 4],
  ['MNM', 'SUP005', 'Hydro Coco 250ml', 'Hydro Coco', 8900, 'PCS', 3],
  ['SMB', 'SUP001', 'Beras Premium Setra Ramos 5kg', 'Topi Koki', 79900, 'SAK', 6, { nonPpn: true }],
  ['SMB', 'SUP001', 'Beras Pulen Wangi 5kg', 'Sania', 74500, 'SAK', 5, { nonPpn: true }],
  ['SMB', 'SUP001', 'Minyak Goreng Bimoli 2L', 'Bimoli', 39900, 'PCH', 7],
  ['SMB', 'SUP001', 'Minyak Goreng Sania 2L', 'Sania', 38500, 'PCH', 6],
  ['SMB', 'SUP001', 'Gula Pasir Gulaku 1kg', 'Gulaku', 18500, 'PCS', 7, { nonPpn: true }],
  ['SMB', 'SUP001', 'Telur Ayam Negeri 10 Butir', 'Peternakan Lokal', 28900, 'PAK', 8, { nonPpn: true }],
  ['SMB', 'SUP001', 'Tepung Terigu Segitiga Biru 1kg', 'Segitiga Biru', 13500, 'PCS', 4],
  ['SMB', 'SUP001', 'Garam Dapur Refina 250g', 'Refina', 4500, 'PCS', 3, { nonPpn: true }],
  ['SMB', 'SUP001', 'Kecap Manis Bango 520ml', 'Bango', 24500, 'PCH', 5],
  ['SMB', 'SUP001', 'Saus Sambal ABC 335ml', 'ABC', 13900, 'BTL', 4],
  ['SMB', 'SUP001', 'Santan Kara 200ml', 'Kara', 7900, 'PCS', 4],
  ['SUS', 'SUP002', 'Ultra Milk Full Cream 1L', 'Ultra Milk', 19900, 'PCS', 6],
  ['SUS', 'SUP002', 'Ultra Milk Coklat 250ml', 'Ultra Milk', 6500, 'PCS', 7],
  ['SUS', 'SUP002', 'Indomilk Kental Manis 370g', 'Indomilk', 12900, 'KLG', 4],
  ['SUS', 'SUP002', 'Frisian Flag Kental Manis 370g', 'Frisian Flag', 12500, 'KLG', 4],
  ['SUS', 'SUP002', 'Bear Brand 189ml', 'Bear Brand', 10900, 'KLG', 5],
  ['SUS', 'SUP002', 'Yakult 5x65ml', 'Yakult', 11500, 'PAK', 5],
  ['SUS', 'SUP002', 'Cimory Yogurt Strawberry 250ml', 'Cimory', 9900, 'BTL', 4],
  ['SUS', 'SUP002', 'Kraft Keju Cheddar 165g', 'Kraft', 24900, 'PCS', 3],
  ['SUS', 'SUP002', 'Greenfields Fresh Milk 1L', 'Greenfields', 26900, 'PCS', 3],
  ['SUS', 'SUP002', 'Dancow Fortigro Instant 800g', 'Dancow', 109000, 'PCS', 2],
  ['MIE', 'SUP001', 'Indomie Goreng 85g', 'Indomie', 3500, 'PCS', 10],
  ['MIE', 'SUP001', 'Indomie Soto Mie 70g', 'Indomie', 3300, 'PCS', 7],
  ['MIE', 'SUP001', 'Indomie Ayam Bawang 69g', 'Indomie', 3300, 'PCS', 6],
  ['MIE', 'SUP001', 'Mie Sedaap Goreng 90g', 'Sedaap', 3400, 'PCS', 8],
  ['MIE', 'SUP001', 'Supermi Ayam Bawang 75g', 'Supermi', 3200, 'PCS', 4],
  ['MIE', 'SUP001', 'Pop Mie Ayam 75g', 'Pop Mie', 6500, 'CUP', 5],
  ['MIE', 'SUP001', 'La Fonte Spaghetti 450g', 'La Fonte', 16900, 'PCS', 2],
  ['BUM', 'SUP001', 'Royco Kaldu Ayam 230g', 'Royco', 10900, 'PCS', 4],
  ['BUM', 'SUP001', 'Masako Kaldu Sapi 250g', 'Masako', 11500, 'PCS', 4],
  ['BUM', 'SUP001', 'Ladaku Merica Bubuk 20g', 'Ladaku', 2500, 'PCS', 3],
  ['BUM', 'SUP001', 'Sasa Penyedap 250g', 'Sasa', 12500, 'PCS', 3],
  ['PRD', 'SUP004', 'Lifebuoy Sabun Batang 110g', 'Lifebuoy', 4500, 'PCS', 6],
  ['PRD', 'SUP004', 'Dettol Body Wash 410ml', 'Dettol', 39900, 'BTL', 3],
  ['PRD', 'SUP004', 'Pantene Shampoo 170ml', 'Pantene', 28900, 'BTL', 4],
  ['PRD', 'SUP004', 'Sunsilk Shampoo 170ml', 'Sunsilk', 24900, 'BTL', 4],
  ['PRD', 'SUP004', 'Pepsodent Pencegah Gigi Berlubang 190g', 'Pepsodent', 14900, 'PCS', 6],
  ['PRD', 'SUP004', 'Sensodyne Repair & Protect 100g', 'Sensodyne', 39900, 'PCS', 2],
  ['PRD', 'SUP004', 'Rexona Men Roll On 45ml', 'Rexona', 22900, 'PCS', 3],
  ['PRD', 'SUP004', 'Biore Body Foam 450ml', 'Biore', 32900, 'PCH', 3],
  ['PRD', 'SUP004', 'Wardah Facial Wash 100ml', 'Wardah', 26900, 'PCS', 3],
  ['PRD', 'SUP004', 'Nivea Men Facial Foam 100ml', 'Nivea', 39900, 'PCS', 2],
  ['PRD', 'SUP004', 'Laurier Super Slim 20s', 'Laurier', 19900, 'PAK', 4],
  ['KBR', 'SUP004', 'Rinso Anti Noda 770g', 'Rinso', 26900, 'PCS', 5],
  ['KBR', 'SUP004', 'So Klin Pewangi 800ml', 'So Klin', 14500, 'PCH', 4],
  ['KBR', 'SUP004', 'Sunlight Jeruk Nipis 755ml', 'Sunlight', 16900, 'PCH', 6],
  ['KBR', 'SUP004', 'Wipol Karbol Cemara 780ml', 'Wipol', 17900, 'PCH', 3],
  ['KBR', 'SUP004', 'Baygon Aerosol 600ml', 'Baygon', 42900, 'KLG', 2],
  ['KBR', 'SUP004', 'Molto Pewangi 900ml', 'Molto', 22900, 'PCH', 4],
  ['KBR', 'SUP004', 'Paseo Facial Tissue 250s', 'Paseo', 14500, 'PAK', 5],
  ['BYI', 'SUP002', 'MamyPoko Pants M 34', 'MamyPoko', 89900, 'PAK', 3],
  ['BYI', 'SUP002', 'Sweety Silver Pants L 26', 'Sweety', 79900, 'PAK', 3],
  ['BYI', 'SUP002', 'SGM Eksplor 1+ 400g', 'SGM', 52900, 'PCS', 3],
  ['BYI', 'SUP002', 'Zwitsal Baby Bath 300ml', 'Zwitsal', 27900, 'BTL', 2],
  ['BSY', 'SUP003', 'Apel Fuji Impor', 'Segar Tani', 49900, 'KG', 5, { nonPpn: true, plu: '10001' }],
  ['BSY', 'SUP003', 'Jeruk Mandarin Impor', 'Segar Tani', 42900, 'KG', 4, { nonPpn: true, plu: '10002' }],
  ['BSY', 'SUP003', 'Pisang Cavendish', 'Segar Tani', 28900, 'KG', 6, { nonPpn: true, plu: '10003' }],
  ['BSY', 'SUP003', 'Semangka Merah Non Biji', 'Segar Tani', 14900, 'KG', 3, { nonPpn: true, plu: '10004' }],
  ['BSY', 'SUP003', 'Anggur Merah Globe', 'Segar Tani', 89900, 'KG', 2, { nonPpn: true, plu: '10005' }],
  ['BSY', 'SUP003', 'Tomat Merah', 'Segar Tani', 18900, 'KG', 5, { nonPpn: true, plu: '10011' }],
  ['BSY', 'SUP003', 'Wortel Lokal', 'Segar Tani', 16500, 'KG', 4, { nonPpn: true, plu: '10012' }],
  ['BSY', 'SUP003', 'Kentang Dieng', 'Segar Tani', 21900, 'KG', 4, { nonPpn: true, plu: '10013' }],
  ['BSY', 'SUP003', 'Bawang Merah Brebes', 'Segar Tani', 45900, 'KG', 5, { nonPpn: true, plu: '10014' }],
  ['BSY', 'SUP003', 'Bawang Putih Kating', 'Segar Tani', 42900, 'KG', 4, { nonPpn: true, plu: '10015' }],
  ['BSY', 'SUP003', 'Cabai Merah Keriting', 'Segar Tani', 58900, 'KG', 4, { nonPpn: true, plu: '10016' }],
  ['BSY', 'SUP003', 'Bayam Hijau Ikat', 'Segar Tani', 4500, 'IKT', 4, { nonPpn: true }],
  ['BSY', 'SUP003', 'Kangkung Ikat', 'Segar Tani', 4000, 'IKT', 4, { nonPpn: true }],
  ['DGI', 'SUP007', 'Daging Sapi Has Dalam', 'Bahari', 175000, 'KG', 3, { nonPpn: true, plu: '20001' }],
  ['DGI', 'SUP007', 'Daging Sapi Giling', 'Bahari', 135000, 'KG', 3, { nonPpn: true, plu: '20002' }],
  ['DGI', 'SUP007', 'Dada Ayam Fillet', 'Bahari', 62900, 'KG', 5, { nonPpn: true, plu: '20003' }],
  ['DGI', 'SUP007', 'Ayam Utuh Karkas', 'Bahari', 42900, 'KG', 4, { nonPpn: true, plu: '20004' }],
  ['DGI', 'SUP007', 'Ikan Salmon Fillet', 'Bahari', 289000, 'KG', 1, { nonPpn: true, plu: '20005' }],
  ['DGI', 'SUP007', 'Udang Vaname', 'Bahari', 115000, 'KG', 2, { nonPpn: true, plu: '20006' }],
  ['DGI', 'SUP007', 'Ikan Kembung Segar', 'Bahari', 49900, 'KG', 3, { nonPpn: true, plu: '20007' }],
  ['ROT', 'SUP002', 'Sari Roti Tawar Kupas', 'Sari Roti', 18500, 'PCS', 6],
  ['ROT', 'SUP002', 'Sari Roti Sandwich Coklat', 'Sari Roti', 6000, 'PCS', 6],
  ['ROT', 'SUP002', 'Bolu Gulung Pandan', 'NusaBakery', 25000, 'PCS', 3],
  ['FRZ', 'SUP007', 'Fiesta Chicken Nugget 500g', 'Fiesta', 52900, 'PCS', 4],
  ['FRZ', 'SUP007', 'So Good Sosis Ayam 375g', 'So Good', 32900, 'PCS', 4],
  ['FRZ', 'SUP007', 'Bernardi Bakso Sapi 500g', 'Bernardi', 46900, 'PCS', 3],
  ['FRZ', 'SUP007', 'Walls Paddle Pop Coklat', 'Walls', 5000, 'PCS', 5],
  ['FRZ', 'SUP007', 'Kanzler Singles Original 360g', 'Kanzler', 41900, 'PCS', 2],
  ['KSH', 'SUP006', 'Panadol Biru 10 Kaplet', 'Panadol', 13900, 'STR', 4],
  ['KSH', 'SUP006', 'Tolak Angin Cair 5 Sachet', 'Sido Muncul', 21900, 'BOX', 4],
  ['KSH', 'SUP006', 'Promag 12 Tablet', 'Promag', 10900, 'STR', 3],
  ['KSH', 'SUP006', 'Betadine Antiseptik 30ml', 'Betadine', 23900, 'BTL', 2],
  ['KSH', 'SUP006', 'Hansaplast Plester 10s', 'Hansaplast', 7900, 'PAK', 3],
  ['KSH', 'SUP006', 'Masker Medis 3 Ply 50pcs', 'Sensi', 29900, 'BOX', 3],
  ['KSH', 'SUP006', 'Minyak Kayu Putih Cap Lang 60ml', 'Cap Lang', 23900, 'BTL', 3],
  ['ATK', 'SUP008', 'Pulpen Standard AE7 Hitam', 'Standard', 2500, 'PCS', 3],
  ['ATK', 'SUP008', 'Buku Tulis Sidu 38 Lembar isi 10', 'Sidu', 32900, 'PAK', 2],
  ['ATK', 'SUP008', 'Pensil 2B Faber-Castell', 'Faber-Castell', 4500, 'PCS', 2],
  ['ATK', 'SUP008', 'Baterai ABC Alkaline AA isi 2', 'ABC', 15900, 'PAK', 3],
];

interface SeedProduct {
  id: number;
  name: string;
  short: string;
  sku: string;
  unit: string;
  categoryId: number;
  supplierId: number;
  price: number;
  cost: number;
  taxType: 'PPN' | 'NON_PPN';
  weighted: boolean;
  pop: number;
  minStock: number;
}
const products: SeedProduct[] = [];
const usedBarcodes = new Set<string>();
const catSeq = new Map<string, number>();
for (const [cat, sup, name, brand, price, unit, pop, opt] of PRODUCTS) {
  const seq = (catSeq.get(cat) ?? 0) + 1;
  catSeq.set(cat, seq);
  const sku = `${cat}${pad(seq, 4)}`;
  const weighted = !!opt?.plu;
  let barcode: string | null = null;
  if (!weighted) {
    do barcode = makeEan13(`899${String(randInt(0, 999999999)).padStart(9, '0')}`);
    while (usedBarcodes.has(barcode));
    usedBarcodes.add(barcode);
  }
  const cost = Math.round((price * (0.72 + rand() * 0.14)) / 100) * 100;
  const taxType = opt?.nonPpn ? 'NON_PPN' : 'PPN';
  const minStock = weighted ? 8 : Math.max(6, pop * 4);
  const short = name.length > 24 ? name.slice(0, 24).trim() : name;
  const id = insert(
    `INSERT INTO products(sku, barcode, plu_code, name, short_name, brand, category_id, supplier_id, unit, cost_price, sell_price,
       tax_type, is_weighted, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    sku,
    barcode,
    opt?.plu ?? null,
    name,
    short,
    brand,
    catId.get(cat),
    supId.get(sup),
    unit,
    cost,
    price,
    taxType,
    weighted ? 1 : 0,
    minStock,
  );
  products.push({ id, name, short, sku, unit, categoryId: catId.get(cat)!, supplierId: supId.get(sup)!, price, cost, taxType, weighted, pop, minStock });
}
const byName = (n: string) => products.find((p) => p.name.startsWith(n))!;

console.log('• Member');
const members: { id: number; points: number; spent: number; no: string }[] = [];
for (let i = 0; i < 80; i++) {
  const no = `8899${String(randInt(0, 999999999999)).padStart(12, '0')}`;
  const name = personName();
  const points = randInt(0, 40) * 50;
  const id = insert(
    'INSERT INTO members(member_no, name, phone, email, birth_date, tier, points, joined_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    no,
    name,
    `08${randInt(11, 59)}${String(randInt(0, 99999999)).padStart(8, '0')}`,
    rand() < 0.6 ? `${name.toLowerCase().replace(/ /g, '.')}${randInt(1, 99)}@mail.com` : null,
    `${randInt(1965, 2003)}-${pad(randInt(1, 12))}-${pad(randInt(1, 28))}`,
    weightedPick(['REGULAR', 'SILVER', 'GOLD', 'PLATINUM'], (t) => ({ REGULAR: 10, SILVER: 5, GOLD: 2, PLATINUM: 1 })[t]!),
    points,
    `${addDays(localDate(), -randInt(40, 900))} 10:00:00`,
  );
  if (points) {
    run(
      `INSERT INTO member_point_ledger(member_id, type, points, balance_after, note, created_at) VALUES (?, 'ADJUST', ?, ?, 'Saldo awal migrasi', ?)`,
      id,
      points,
      points,
      `${addDays(localDate(), -31)} 06:00:00`,
    );
  }
  members.push({ id, points, spent: 0, no });
}

console.log('• Promosi');
const today = localDate();
const PROMOS = [
  { code: 'MIE4G1', name: 'Beli 4 Gratis 1 Indomie Goreng', type: 'BUY_X_GET_Y', value: 0, buy: 4, get: 1, scope: 'PRODUCT', targets: [byName('Indomie Goreng').id], member: 0, store: null, start: -20, end: 25 },
  { code: 'MINUM15', name: 'Diskon 15% Minuman Dingin', type: 'PERCENT', value: 15, buy: null, get: null, scope: 'PRODUCT', targets: ['Coca-Cola', 'Sprite', 'Pocari', 'Floridina', 'Hydro Coco'].map((n) => byName(n).id), member: 0, store: null, start: -10, end: 10 },
  { code: 'CHITATO3', name: 'Chitato 3 pcs Rp 30.000', type: 'BUNDLE_PRICE', value: 30000, buy: 3, get: null, scope: 'PRODUCT', targets: [byName('Chitato').id], member: 0, store: null, start: -30, end: 30 },
  { code: 'MBRBIMOLI', name: 'Harga Member Bimoli 2L', type: 'SPECIAL_PRICE', value: 34900, buy: null, get: null, scope: 'PRODUCT', targets: [byName('Minyak Goreng Bimoli').id], member: 1, store: null, start: -15, end: 15 },
  { code: 'ULTRA2K', name: 'Hemat Rp 2.000 Ultra Milk 1L', type: 'AMOUNT', value: 2000, buy: null, get: null, scope: 'PRODUCT', targets: [byName('Ultra Milk Full Cream').id], member: 0, store: null, start: -25, end: 5 },
  { code: 'BUAHMBR10', name: 'Buah Segar 10% Khusus Member', type: 'PERCENT', value: 10, buy: null, get: null, scope: 'CATEGORY', targets: [catId.get('BSY')!], member: 1, store: null, start: -30, end: 30 },
  { code: 'SBYGRAND', name: 'Grand Promo Tunjungan: Snack 20%', type: 'PERCENT', value: 20, buy: null, get: null, scope: 'CATEGORY', targets: [catId.get('SNK')!], member: 0, store: 'SBY01', start: -7, end: 7 },
  { code: 'PAYDAY10', name: 'Payday Perawatan Diri 10%', type: 'PERCENT', value: 10, buy: null, get: null, scope: 'CATEGORY', targets: [catId.get('PRD')!], member: 0, store: null, start: 20, end: 26 },
  { code: 'MERDEKA17', name: 'Promo Kemerdekaan Sembako 17%', type: 'PERCENT', value: 17, buy: null, get: null, scope: 'CATEGORY', targets: [catId.get('SMB')!], member: 0, store: null, start: -90, end: -75 },
];
const adminId = 1;
for (const p of PROMOS) {
  const storeId = p.store ? stores.find((s) => s.code === p.store)!.id : null;
  const id = insert(
    `INSERT INTO promotions(code, name, type, value, buy_qty, get_qty, min_qty, scope, member_only, store_id, start_date, end_date, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    p.code,
    p.name,
    p.type,
    p.value,
    p.buy,
    p.get,
    p.scope,
    p.member,
    storeId,
    addDays(today, p.start),
    addDays(today, p.end),
    adminId,
  );
  for (const t of p.targets) run('INSERT INTO promotion_targets(promotion_id, target_id) VALUES (?, ?)', id, t);
}
const promoRules: PromoRule[] = all(
  `SELECT p.*, GROUP_CONCAT(t.target_id) AS targets FROM promotions p JOIN promotion_targets t ON t.promotion_id = p.id GROUP BY p.id`,
).map(toPromoRule);

// ---------------------------------------------------------------- Riwayat transaksi
console.log('• Riwayat transaksi 30 hari (mohon tunggu)…');
const stockMap = new Map<string, number>();
// Penjualan sejak pengiriman terakhir, untuk menghitung kebutuhan restock.
const soldSince = new Map<string, number>();
const sk = (s: number, p: number) => `${s}:${p}`;
const seq = new Map<string, number>();
const nextSeq = (key: string) => {
  const n = (seq.get(key) ?? 0) + 1;
  seq.set(key, n);
  return n;
};
const yymm = (d: string) => d.slice(2, 4) + d.slice(5, 7);
const docNo = (prefix: string, store: string, date: string) => `${prefix}/${store}/${yymm(date)}/${pad(nextSeq(`${prefix}:${store}:${yymm(date)}`), 4)}`;

const stmt = {
  movement: db.prepare(
    `INSERT INTO stock_movements(store_id, product_id, type, qty, balance_after, ref_type, ref_id, ref_no, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  shift: db.prepare(
    `INSERT INTO shifts(shift_no, store_id, terminal_id, user_id, schedule_id, status, opening_cash, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  schedule: db.prepare('INSERT INTO shift_schedules(store_id, terminal_id, user_id, start_at, end_at, created_by) VALUES (?, ?, ?, ?, ?, ?)'),
  closeShift: db.prepare(
    `UPDATE shifts SET status='CLOSED', closed_at=?, expected_cash=?, counted_cash=?, variance=?, denominations=?, closing_note=? WHERE id=?`,
  ),
  sale: db.prepare(
    `INSERT INTO sales(receipt_no, store_id, terminal_id, shift_id, cashier_id, member_id, subtotal, discount_total, total, dpp,
       tax_amount, tax_rate, paid_total, change_amount, item_count, points_earned, status, void_reason, voided_by, voided_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 11, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  item: db.prepare(
    `INSERT INTO sale_items(sale_id, product_id, sku, name, unit, qty, unit_price, cost_price, gross, discount, net, tax_type, promo_id, promo_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ),
  payment: db.prepare('INSERT INTO sale_payments(sale_id, method, amount, reference) VALUES (?, ?, ?, ?)'),
  ledger: db.prepare(
    `INSERT INTO member_point_ledger(member_id, type, points, balance_after, ref_no, created_at) VALUES (?, 'EARN', ?, ?, ?, ?)`,
  ),
  cash: db.prepare('INSERT INTO cash_movements(shift_id, type, amount, reason, user_id, approved_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
};

function move(storeId: number, productId: number, qty: number, type: string, refType: string | null, refId: number | null, refNo: string | null, at: string, userId: number | null, note: string | null = null) {
  const key = sk(storeId, productId);
  const bal = Math.round(((stockMap.get(key) ?? 0) + qty) * 1000) / 1000;
  stockMap.set(key, bal);
  if (type === 'SALE') soldSince.set(key, (soldSince.get(key) ?? 0) - qty);
  stmt.movement.run(storeId, productId, type, qty, bal, refType, refId, refNo, note, userId, at);
}

// Distribusi jam ramai (07.00–22.00)
const HOUR_WEIGHT: Record<number, number> = { 7: 3, 8: 4, 9: 5, 10: 6, 11: 8, 12: 10, 13: 8, 14: 6, 15: 6, 16: 8, 17: 10, 18: 12, 19: 12, 20: 9, 21: 5 };
const now = new Date();
const nowStr = localDateTime(now);
/** Waktu lokal dari tanggal + jam desimal (boleh > 24 untuk hari berikutnya). */
const hourAt = (date: string, hour: number) => localDateTime(new Date(new Date(`${date}T00:00:00`).getTime() + Math.round(hour * 3600) * 1000));

tx(() => {
  const startDay = addDays(today, -30);
  // Saldo awal stok
  for (const s of stores) {
    for (const p of products) {
      const qty = p.weighted ? p.pop * 12 + randInt(20, 40) : p.pop * (s.traffic / 2) + randInt(30, 80);
      move(s.id, p.id, Math.round(qty), 'OPENING', null, null, 'SALDO-AWAL', `${addDays(startDay, -1)} 06:00:00`, adminId, 'Saldo awal implementasi sistem');
    }
  }

  for (let d = 0; d <= 30; d++) {
    const date = addDays(startDay, d);
    const dow = new Date(`${date}T00:00:00`).getDay();
    const dayFactor = dow === 0 || dow === 6 ? 1.3 : dow === 5 ? 1.1 : 1;

    // Pengiriman supplier 2x seminggu (Senin & Kamis) berdasarkan kecepatan jual 4 hari + safety stock.
    if ((dow === 1 || dow === 4) && d > 0) {
      for (const s of stores) {
        const gudang = all<{ id: number }>(`SELECT id FROM users WHERE store_id = ? AND role = 'INVENTORY'`, s.id)[0].id;
        for (const [, supplierId] of supId) {
          const lines = products
            .filter((p) => p.supplierId === supplierId)
            .map((p) => {
              const key = sk(s.id, p.id);
              const target = (soldSince.get(key) ?? 0) * 1.4 + p.minStock * 2;
              const need = target - (stockMap.get(key) ?? 0);
              const pack = p.weighted ? 5 : 12;
              return { p, qty: need > p.minStock ? Math.ceil(need / pack) * pack : 0 };
            })
            .filter((l) => l.qty > 0 && rand() < 0.93);
          if (!lines.length) continue;
          const at = `${date} 06:30:00`;
          const no = docNo('GR', s.code, date);
          const grId = insert(
            `INSERT INTO goods_receipts(gr_no, store_id, supplier_id, invoice_no, total_cost, note, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            no,
            s.id,
            supplierId,
            `INV-${randInt(100000, 999999)}`,
            lines.reduce((sum, l) => sum + l.qty * l.p.cost, 0),
            'Pengiriman rutin supplier',
            gudang,
            at,
          );
          for (const l of lines) {
            run('INSERT INTO goods_receipt_items(gr_id, product_id, qty, cost_price) VALUES (?, ?, ?, ?)', grId, l.p.id, l.qty, l.p.cost);
            move(s.id, l.p.id, l.qty, 'RECEIVE', 'goods_receipt', grId, no, at, gudang);
            soldSince.set(sk(s.id, l.p.id), 0);
          }
        }
      }
    }

    for (const s of stores) {
      const spv = s.cashiers[s.cashiers.length - 1];
      s.terminals.forEach((t, ti) => {
        (SLOTS[s.code] ?? DEFAULT_SLOTS).forEach((sh, si) => {
          const openAt = hourAt(date, sh.from);
          const closeAt = hourAt(date, sh.to);
          const running = openAt <= nowStr && nowStr < closeAt;
          // Slot berjalan: POS-01 → kasir1, POS-02 → kasir2, dst. Selain itu bergilir.
          const cashier = running ? s.cashiers[ti] : s.cashiers[(ti + si + d) % (s.cashiers.length - 1)];
          const scheduleId = Number(stmt.schedule.run(s.id, t.id, cashier, openAt, closeAt, s.manager).lastInsertRowid);
          if (openAt > nowStr) return;
          // Shift POS-01 yang sedang berjalan sengaja tidak dibuka agar kasir1 dapat mencoba buka shift otomatis.
          if (running && ti === 0) return;
          const opening = 500000;
          const shiftId = Number(stmt.shift.run(docNo('SHF', s.code, date), s.id, t.id, cashier, scheduleId, 'OPEN', opening, openAt).lastInsertRowid);
          const termFactor = ti === 0 ? 1 : ti === 1 ? 0.75 : 0.5;
          const cashIn = 0;
          let changeTotal = 0;
          const refunds = 0;
          let pickups = 0;
          let completedCash = 0;
          const hours = Array.from({ length: sh.to - sh.from }, (_, i) => sh.from + i);
          const weight = (h: number) => HOUR_WEIGHT[h % 24] ?? 1;
          const expectedTrx = Math.round(
            ((s.traffic * dayFactor * termFactor) / 2) * (0.85 + rand() * 0.3) * (hours.reduce((a, h) => a + weight(h), 0) / 70),
          );
          const times: string[] = [];
          for (let i = 0; i < expectedTrx; i++) {
            const at = hourAt(date, weightedPick(hours, weight) + randInt(0, 3599) / 3600);
            if (at < nowStr) times.push(at);
          }
          times.sort();
          for (const at of times) {
            const member = rand() < 0.38 ? pick(members) : null;
            const lineCount = weightedPick([1, 2, 3, 4, 5, 6, 8, 10], (n) => ({ 1: 14, 2: 18, 3: 18, 4: 14, 5: 10, 6: 8, 8: 5, 10: 3 })[n]!);
            const chosen = new Map<number, number>();
            for (let i = 0; i < lineCount; i++) {
              const p = weightedPick(products, (x) => x.pop * x.pop);
              const qty = p.weighted
                ? Math.round((0.2 + rand() * 1.6) * 1000) / 1000
                : weightedPick([1, 2, 3, 4, 5], (n) => ({ 1: 60, 2: 22, 3: 8, 4: 6, 5: 4 })[n]!);
              chosen.set(p.id, p.weighted ? qty : (chosen.get(p.id) ?? 0) + qty);
            }
            const ctx = { isMember: !!member, storeId: s.id, date };
            const lines = [...chosen].map(([pid, qty]) => {
              const p = products.find((x) => x.id === pid)!;
              const price = priceLine(
                { productId: p.id, categoryId: p.categoryId, unitPrice: p.price, qty, taxType: p.taxType, isWeighted: p.weighted },
                promoRules,
                ctx,
              );
              return { p, qty, isWeighted: p.weighted, taxType: p.taxType, price };
            });
            const totals = summarize(lines, 11);
            const method = weightedPick(['CASH', 'QRIS', 'DEBIT', 'EWALLET', 'CREDIT'], (m) => ({ CASH: 48, QRIS: 22, DEBIT: 15, EWALLET: 10, CREDIT: 5 })[m]!);
            let paid = totals.total;
            if (method === 'CASH') {
              const step = weightedPick([0, 1000, 5000, 10000, 50000, 100000], (x) => ({ 0: 12, 1000: 10, 5000: 18, 10000: 25, 50000: 25, 100000: 10 })[x]!);
              paid = step ? Math.ceil(totals.total / step) * step : totals.total;
              if (paid === totals.total && step >= 50000) paid += step;
            }
            const change = paid - totals.total;
            const earned = member ? pointsEarned(totals.total, 10000) : 0;
            const voided = rand() < 0.008;
            const receipt = `${s.code}-${pad(ti + 1)}-${date.slice(2).replace(/-/g, '')}-${pad(nextSeq(`RCP:${s.code}:${pad(ti + 1)}:${date.slice(2).replace(/-/g, '')}`), 4)}`;
            const saleId = Number(
              stmt.sale.run(
                receipt,
                s.id,
                t.id,
                shiftId,
                cashier,
                member?.id ?? null,
                totals.subtotal,
                totals.discountTotal,
                totals.total,
                totals.dpp,
                totals.tax,
                paid,
                change,
                totals.itemCount,
                voided ? 0 : earned,
                voided ? 'VOIDED' : 'COMPLETED',
                voided ? 'Pelanggan membatalkan pembelian' : null,
                voided ? spv : null,
                voided ? at : null,
                at,
              ).lastInsertRowid,
            );
            for (const l of lines) {
              stmt.item.run(saleId, l.p.id, l.p.sku, l.p.name, l.p.unit, l.qty, l.p.price, l.p.cost, l.price.gross, l.price.discount, l.price.net, l.p.taxType, l.price.promoId, l.price.promoName);
              move(s.id, l.p.id, -l.qty, 'SALE', 'sale', saleId, receipt, at, cashier);
              if (voided) move(s.id, l.p.id, l.qty, 'VOID', 'sale', saleId, receipt, at, cashier);
            }
            stmt.payment.run(saleId, method, paid, method === 'CASH' ? null : String(randInt(100000, 999999)));
            if (voided) continue;
            if (method === 'CASH') {
              completedCash += paid;
              changeTotal += change;
            }
            if (member && earned) {
              member.points += earned;
              stmt.ledger.run(member.id, earned, member.points, receipt, at);
            }
            if (member) member.spent += totals.total;
          }
          // Pickup kas ketika laci terlalu penuh (umum di supermarket)
          const drawer = opening + completedCash - changeTotal;
          if (drawer > 4_000_000 && times.length) {
            pickups = Math.floor((drawer - 1_000_000) / 1_000_000) * 1_000_000;
            stmt.cash.run(shiftId, 'PICKUP', pickups, 'Setoran ke brankas', cashier, spv, times[Math.floor(times.length * 0.6)]);
          }
          if (!running) {
            const expected = opening + completedCash - changeTotal + cashIn - pickups - refunds;
            const variance = rand() < 0.85 ? 0 : pick([-2000, -500, 500, 1000, -10000]);
            const counted = expected + variance;
            let rest = counted;
            const denoms: Record<string, number> = {};
            for (const dn of [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100]) {
              const n = Math.floor(rest / dn);
              if (n) denoms[dn] = n;
              rest -= n * dn;
            }
            stmt.closeShift.run(hourAt(date, sh.to + 5 / 60), expected, counted, variance, JSON.stringify(denoms), variance ? 'Selisih sudah dikonfirmasi supervisor' : null, shiftId);
          }
        });
      });
    }
  }

  // Jadwal kasir 6 hari ke depan
  for (let d = 31; d <= 36; d++) {
    const date = addDays(startDay, d);
    for (const s of stores) {
      s.terminals.forEach((t, ti) =>
        (SLOTS[s.code] ?? DEFAULT_SLOTS).forEach((sh, si) =>
          stmt.schedule.run(s.id, t.id, s.cashiers[(ti + si + d) % (s.cashiers.length - 1)], hourAt(date, sh.from), hourAt(date, sh.to), s.manager),
        ),
      );
    }
  }

  for (const [key, qty] of stockMap) {
    const [storeId, productId] = key.split(':').map(Number);
    run('INSERT INTO stock(store_id, product_id, qty) VALUES (?, ?, ?)', storeId, productId, qty);
  }
  for (const m of members) run('UPDATE members SET points = ?, total_spent = ? WHERE id = ?', m.points, m.spent, m.id);
  for (const [key, last] of seq) run('INSERT INTO doc_sequences(key, last) VALUES (?, ?)', key, last);
});

// ---------------------------------------------------------------- Dokumen pembelian & transfer contoh
console.log('• Purchase order & transfer contoh');
{
  const jkt = stores[0];
  const manager = all<{ id: number }>(`SELECT id FROM users WHERE store_id = ? AND role = 'STORE_MANAGER'`, jkt.id)[0].id;
  const gudang = all<{ id: number }>(`SELECT id FROM users WHERE store_id = ? AND role = 'INVENTORY'`, jkt.id)[0].id;
  const mkPo = (supplier: string, status: string, items: SeedProduct[], note: string) => {
    const no = docNo('PO', jkt.code, today);
    const id = insert(
      `INSERT INTO purchase_orders(po_no, store_id, supplier_id, status, expected_date, note, created_by, approved_by, approved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      no,
      jkt.id,
      supId.get(supplier),
      status,
      addDays(today, 3),
      note,
      gudang,
      status === 'DRAFT' ? null : manager,
      status === 'DRAFT' ? null : localDateTime(),
    );
    let total = 0;
    for (const p of items) {
      const qty = p.minStock * 4;
      total += qty * p.cost;
      run('INSERT INTO purchase_order_items(po_id, product_id, qty, cost_price) VALUES (?, ?, ?, ?)', id, p.id, qty, p.cost);
    }
    run('UPDATE purchase_orders SET total = ? WHERE id = ?', total, id);
  };
  mkPo('SUP005', 'APPROVED', products.filter((p) => p.supplierId === supId.get('SUP005')).slice(0, 6), 'Persiapan stok akhir pekan');
  mkPo('SUP004', 'DRAFT', products.filter((p) => p.supplierId === supId.get('SUP004')).slice(0, 5), 'Draft order kebersihan');

  const no = docNo('TRF', jkt.code, today);
  const trId = insert(
    'INSERT INTO stock_transfers(transfer_no, from_store_id, to_store_id, note, created_by) VALUES (?, ?, ?, ?, ?)',
    no,
    jkt.id,
    stores[1].id,
    'Bantuan stok untuk Kelapa Gading',
    gudang,
  );
  for (const p of [byName('Aqua Air Mineral 600ml'), byName('Indomie Goreng'), byName('Teh Pucuk')]) {
    run('INSERT INTO stock_transfer_items(transfer_id, product_id, qty) VALUES (?, ?, ?)', trId, p.id, 48);
    const bal = Math.round(((stockMap.get(sk(jkt.id, p.id)) ?? 0) - 48) * 1000) / 1000;
    run('UPDATE stock SET qty = ? WHERE store_id = ? AND product_id = ?', bal, jkt.id, p.id);
    run(
      `INSERT INTO stock_movements(store_id, product_id, type, qty, balance_after, ref_type, ref_id, ref_no, user_id) VALUES (?, ?, 'TRANSFER_OUT', -48, ?, 'transfer', ?, ?, ?)`,
      jkt.id,
      p.id,
      bal,
      trId,
      no,
      gudang,
    );
  }
  // Stock opname & barang kedaluwarsa — sekaligus memunculkan beberapa barang di bawah stok minimum.
  const adjust = (store: SeedStore, type: string, note: string, items: { p: SeedProduct; actual: number }[], daysAgo: number) => {
    const at = `${addDays(today, -daysAgo)} 21:30:00`;
    const userId = all<{ id: number }>(`SELECT id FROM users WHERE store_id = ? AND role = 'INVENTORY'`, store.id)[0].id;
    const adjNo = docNo(type === 'OPNAME' ? 'SO' : 'ADJ', store.code, today);
    const adjId = insert('INSERT INTO stock_adjustments(adj_no, store_id, type, note, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', adjNo, store.id, type, note, userId, at);
    for (const { p, actual } of items) {
      const system = all<{ qty: number }>('SELECT qty FROM stock WHERE store_id = ? AND product_id = ?', store.id, p.id)[0].qty;
      const diff = Math.round((actual - system) * 1000) / 1000;
      run(
        'INSERT INTO stock_adjustment_items(adjustment_id, product_id, system_qty, actual_qty, diff_qty, cost_price) VALUES (?, ?, ?, ?, ?, ?)',
        adjId,
        p.id,
        system,
        actual,
        diff,
        p.cost,
      );
      run('UPDATE stock SET qty = ? WHERE store_id = ? AND product_id = ?', actual, store.id, p.id);
      stmt.movement.run(store.id, p.id, type, diff, actual, 'adjustment', adjId, adjNo, note, userId, at);
    }
  };
  for (const store of stores) {
    const candidates = products.filter((p) => !p.weighted).sort(() => rand() - 0.5);
    adjust(store, 'OPNAME', 'Stock opname rak periodik', candidates.slice(0, 5).map((p) => ({ p, actual: randInt(1, Math.max(2, p.minStock - 2)) })), 2);
    adjust(store, 'EXPIRED', 'Penarikan produk mendekati kedaluwarsa', candidates.slice(5, 7).map((p) => ({ p, actual: randInt(0, 3) })), 1);
  }
  for (const [key, last] of seq) run('INSERT INTO doc_sequences(key, last) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET last = excluded.last', key, last);
}

function tx(fn: () => void) {
  db.transaction(fn)();
}

const count = (t: string) => all<{ n: number }>(`SELECT COUNT(*) n FROM ${t}`)[0].n;
console.log(`\n✔ Selesai: ${count('stores')} toko, ${count('products')} produk, ${count('members')} member, ${count('sales')} transaksi, ${count('stock_movements')} mutasi stok.`);
console.log(`
Akun demo (password):
  admin            / admin123   — Super Admin (PIN 123456)
  hq               / hq123456   — Admin Kantor Pusat
  manager.jkt01    / password   — Kepala Toko JKT01 (PIN 123456)
  spv.jkt01        / password   — Supervisor JKT01 (PIN 123456)
  kasir1.jkt01     / password   — Kasir JKT01
  gudang.jkt01     / password   — Staf Gudang JKT01
`);
db.close();
