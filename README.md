# NusaPOS

Aplikasi kasir (POS) dan backoffice untuk penggunaan pribadi. Mendukung beberapa toko dan beberapa terminal kasir.

## Fitur

**Kasir (POS)** — dioperasikan dengan keyboard dan barcode scanner
- Scan barcode EAN, SKU, PLU, dan **label timbangan** (berat terbaca otomatis dari barcode)
- Input jumlah cepat `3*kode`, cari barang (F2), ubah qty (F3)
- Promo otomatis: diskon %, potongan per unit, harga spesial, beli X gratis Y, harga paket — sistem memilih promo terbaik untuk pelanggan
- Member: scan kartu / no. HP, daftar member baru di kasir, poin otomatis, bayar pakai poin
- **Split payment**: tunai, debit, kredit, QRIS, e-wallet, voucher, poin
- Katalog toko dimuat di kasir: scan barcode tanpa menunggu server; saat mengetik nama/kode/kategori, saran barang langsung muncul
- **Scan lewat kamera** (webcam / kamera HP) bila tidak ada alat scanner: di kasir kamera tetap terbuka untuk scan beruntun; juga tersedia di riwayat (barcode struk), member (kartu), form produk, dan semua input barang backoffice
- Tunda & panggil transaksi (lintas terminal di toko yang sama)
- **Riwayat transaksi** (F5): daftar transaksi shift berjalan / terminal hari ini, dengan cetak ulang, void, dan retur
- **Otorisasi supervisor (username + PIN)** untuk hapus item, kurangi qty, batal transaksi, void, retur, mutasi kas
- **Jadwal shift** dari kepala toko: shift terbuka otomatis saat kasir terjadwal login, peringatan 15 menit sebelum selesai, wajib tutup shift saat jam habis, lalu keluar otomatis dan halaman login menampilkan kasir berikutnya
- Kasir tidak bisa logout selama shift berjalan; tersedia **kunci layar** (buka dengan password) untuk istirahat
- Shift kasir: modal awal, kas masuk/keluar, **pickup setoran** (peringatan laci penuh), tutup shift dengan **hitung pecahan uang (blind count)**, laporan X/Z
- Struk thermal 80 mm (DPP, PPN, penanda barang non-PPN, info poin, barcode nomor struk), cetak ulang
- Checkout dengan ID unik per transaksi, sehingga kiriman ulang tidak dicatat dua kali

**Backoffice**
- Dashboard real-time: penjualan vs kemarin (jam yang sama), ATV, laba kotor & margin, tren 30 hari, penjualan per jam, kategori, metode bayar, produk terlaris, performa toko, stok menipis, shift aktif
- Laporan penjualan per hari / jam / toko / kasir / terminal / kategori / produk / supplier / promo / metode bayar, lengkap dengan HPP, laba kotor, margin; ekspor CSV
- Master produk (impor/ekspor CSV), kategori, supplier, label harga rak A4 (dengan harga promo)
- Persediaan multi-toko: saldo stok & nilai persediaan, kartu stok, **purchase order** (draft → approve → terima) dengan **saran order otomatis**, penerimaan barang (HPP rata-rata bergerak), transfer antar toko, stock opname & penyesuaian (rusak/kedaluwarsa/hilang)
- Member & ledger poin, transaksi (void dari backoffice), riwayat shift & selisih kas
- Pengguna & role, toko & terminal, **audit trail**, pengaturan perusahaan/PPN/poin/kebijakan kasir

## Teknologi

| Lapisan | Teknologi |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS 4, React Router |
| Backend | Node.js, Express, TypeScript (tsx), Zod |
| Database | SQLite (WAL) via better-sqlite3 — nominal disimpan sebagai integer Rupiah |
| Keamanan | JWT, bcrypt, role-based access control, pembatasan percobaan login, Helmet |
| Bersama | `shared/` — mesin harga & PPN, izin role, utilitas barcode dipakai client **dan** server (server tetap otoritatif saat checkout) |

## Menjalankan

Prasyarat: Node.js 20+.

```bash
npm run setup     # install dependensi + isi data demo + build frontend
npm run dev       # mode pengembangan: API :4000 + web :5173 (buka http://localhost:5173)
```

Mode produksi (satu proses, web + API di port 4000):

```bash
npm run build
npm start         # buka http://localhost:4000
```

`npm run seed` **menghapus** database lalu mengisi data demo: 4 toko, 12 terminal, 119 produk, 80 member, 9 promo, dan ±18.000 transaksi 30 hari terakhir. Tanpa seed, server membuat akun `admin` dengan password acak yang ditampilkan di konsol.

### Akun demo

| Username | Password | Role |
|---|---|---|
| `admin` | `admin123` | Super Admin (PIN 123456) |
| `hq` | `hq123456` | Admin Kantor Pusat |
| `manager.jkt01` | `password` | Kepala Toko (PIN 123456) |
| `spv.jkt01` | `password` | Supervisor (PIN 123456) |
| `kasir1.jkt01` | `password` | Kasir |
| `gudang.jkt01` | `password` | Staf Gudang |

Pola yang sama berlaku untuk toko lain (`jkt02`, `bdg01`, `sby01`).

### Variabel lingkungan (opsional)

| Nama | Default | Keterangan |
|---|---|---|
| `PORT` | `4000` | Port HTTP |
| `DATA_DIR` | `server/data` | Lokasi database & secret |
| `DB_PATH` | `$DATA_DIR/pos.db` | File database |
| `JWT_SECRET` | dibuat otomatis | Disimpan di `$DATA_DIR/.jwt-secret` bila tidak diisi |

## Pintasan keyboard kasir

| Tombol | Fungsi | | Tombol | Fungsi |
|---|---|---|---|---|
| Scan / Enter | Tambah barang (barcode, SKU, PLU) | | F6 | Tunda transaksi |
| Ketik nama | Saran barang; ↑ ↓ lalu Enter | | F7 | Panggil transaksi tertunda |
| `3*kode` | Scan dengan qty 3 | | F8 / Del | Hapus item (otorisasi) |
| `+` | Tambah 1 qty barang terpilih | | F9 | Batal transaksi (otorisasi) |
| F2 | Cari barang (daftar lengkap) | | F10 | Bayar |
| F3 | Ubah qty | | F12 | Menu: kas, laporan X, kunci layar, tutup shift |
| F4 | Member | | ↑ ↓ | Pilih baris |
| F5 | Riwayat transaksi, void, retur | | Esc | Tutup jendela / hapus ketikan |

Enter pada kolom scan: kode persis → saran yang dipilih → saran tunggal langsung masuk → bila banyak saran, daftar pencarian dibuka.

Tombol **Kamera** di samping kolom scan membuka pemindai kamera; barang yang terbaca langsung masuk sampai menekan Selesai.

Di layar bayar: F1–F7 memilih metode, Enter menambah pembayaran / menyelesaikan.

**Barcode timbangan** (EAN-13, prefix GS1 in-store 20–29): `2F PPPPP WWWWW C` — PLU 5 digit, berat dalam gram, check digit. Contoh `2010003012502` = Pisang Cavendish (PLU 10003) 1,250 kg.

## Aturan bisnis utama

- **PPN**: harga jual sudah termasuk PPN (default 11%, dapat diubah). DPP = total barang kena pajak × 100/(100+tarif). Barang kebutuhan pokok ditandai Non-PPN.
- **Promo**: tidak ditumpuk; per baris dipilih potongan terbesar. Promo dapat dibatasi per toko, periode, dan khusus member.
- **Poin**: default 1 poin per Rp 10.000, 1 poin = Rp 100. Void mengembalikan poin; retur memotong poin secara proporsional.
- **Jadwal**: kasir hanya dapat membuka shift di terminal & jam yang dijadwalkan (paling cepat 30 menit sebelum mulai). Supervisor/kepala toko boleh membuka shift cadangan tanpa jadwal. Aturan ini dapat dimatikan di Pengaturan.
- Jika kasir sebelumnya pergi tanpa menutup shift, kasir berikutnya dapat menghitung kas dan menutupnya dengan otorisasi PIN supervisor.
- **Void** hanya selama shift transaksi masih terbuka; setelah shift ditutup gunakan **retur** (refund tunai dari laci shift yang sedang berjalan).
- **Kas seharusnya** = modal + tunai bersih (setelah kembalian) + kas masuk − kas keluar − pickup − refund.
- **HPP** dihitung ulang tiap penerimaan barang dengan metode rata-rata bergerak; laba kotor di laporan dihitung dari penjualan tanpa PPN.
- Semua dokumen bernomor otomatis per toko per bulan (`GR/JKT01/2611/0001`), struk per terminal per hari (`JKT01-01-261102-0001`).

## Hak akses role

| Fitur | Super Admin | Kantor Pusat | Kepala Toko | Supervisor | Kasir | Gudang |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Kasir (POS) | ✓ | | ✓ | ✓ | ✓ | |
| Atur jadwal kasir | ✓ | ✓ | ✓ | | | |
| Otorisasi PIN | ✓ | | ✓ | ✓ | | |
| Dashboard | ✓ | ✓ | ✓ | ✓ | | ✓ |
| Laporan penjualan | ✓ | ✓ | ✓ | | | |
| Kelola produk & promo | ✓ | ✓ | | | | |
| Kelola stok & PO | ✓ | ✓ | ✓ | | | ✓ |
| Kelola pengguna | ✓ | ✓ | ✓ (tokonya) | | | |
| Toko & terminal, pengaturan | ✓ | toko saja | | | | |

User toko otomatis terkunci ke data tokonya; user kantor pusat dapat memilih toko atau melihat agregat nasional. Detail lengkap ada di `shared/permissions.ts`.

## Struktur proyek

```
shared/          tipe domain, mesin harga & PPN, izin role, barcode
server/src/
  db/            skema, koneksi, seed data demo
  lib/           stok, penomoran dokumen, audit, pengaturan, promo
  middleware/    autentikasi, otorisasi, PIN supervisor
  routes/        auth, master, products, members, promotions, pos, shifts,
                 sales, inventory, purchasing, reports
client/src/
  components/    UI kit, grafik SVG, struk & cetak, dialog bersama
  pages/pos/     layar kasir
  pages/backoffice/
```

## Perangkat keras

- **Barcode scanner**: mode keyboard (HID) dengan suffix Enter — langsung bekerja di layar kasir.
- **Kamera** (alternatif scanner): browser hanya mengizinkan kamera di `http://localhost` atau `https://`. Membuka aplikasi dari HP/tablet lewat `http://192.168.x.x` membuat kamera tidak bisa dipakai; untuk itu server perlu HTTPS. Format yang terbaca: EAN-13/8, UPC, Code128, Code39, ITF, QR. Webcam laptop yang fokusnya tetap butuh jarak ±15–20 cm dan cahaya cukup.
- **Printer struk**: printer thermal 80 mm melalui dialog cetak browser. Untuk cetak tanpa dialog, jalankan Chrome dengan `--kiosk-printing`.
- **Timbangan label**: atur format label ke `2F PPPPP WWWWW C` dan samakan kode PLU dengan master produk.
- **Label rak**: kertas label A4 63,5 × 38,1 mm (3 × 7).

## Keterbatasan

- Database SQLite di satu server; belum ada sinkronisasi antar server atau mode offline di kasir.
- Pembayaran non-tunai (EDC, QRIS) dicatat manual lewat nomor referensi, belum terhubung ke penyedia pembayaran.
- Belum ada integrasi e-Faktur maupun akuntansi.
