const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;
const DB_FILE = path.join(__dirname, 'kantin.db');
const JSON_FALLBACK_FILE = path.join(__dirname, 'data.json'); // dipakai kalau SQLite tidak tersedia, atau untuk migrasi data lama

// ---------------------------------------------------------------
// DATABASE (SQLite) — supaya akun (username/password), menu,
// pesanan, dan promo tersimpan permanen di file database asli.
// SQLite menulis secara "atomic", jadi lebih tahan crash dibanding
// menulis file JSON langsung.
//
// Kalau modul native better-sqlite3 gagal dimuat di environment
// tertentu (misal karena versi Node yang belum didukung), server
// TIDAK ikut mati — otomatis beralih memakai file data.json biasa
// supaya aplikasi tetap bisa dipakai.
// ---------------------------------------------------------------
let mode = 'sqlite';
let db = null;

try {
  const Database = require('better-sqlite3');
  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL'); // lebih cepat & aman untuk akses bersamaan

  db.exec(`
    CREATE TABLE IF NOT EXISTS store (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  // Migrasi otomatis (sekali saja): kalau database masih kosong tapi ada
  // data.json peninggalan versi lama/fallback, pindahkan isinya supaya
  // akun & data lama yang sudah ada tidak hilang.
  const existingRow = db.prepare('SELECT payload FROM store WHERE id = 1').get();
  if (!existingRow && fs.existsSync(JSON_FALLBACK_FILE)) {
    try {
      const legacyContent = fs.readFileSync(JSON_FALLBACK_FILE, 'utf8');
      JSON.parse(legacyContent); // pastikan valid JSON dulu
      db.prepare('INSERT INTO store (id, payload, updated_at) VALUES (1, ?, ?)')
        .run(legacyContent, new Date().toISOString());
      console.log('Data lama berhasil dipindahkan ke database SQLite (kantin.db).');
    } catch (e) {
      console.error('Gagal migrasi data lama, akan mulai dengan data kosong:', e.message);
    }
  }
} catch (e) {
  mode = 'json';
  console.error('⚠️  better-sqlite3 tidak bisa dimuat di environment ini (' + e.message + ').');
  console.error('⚠️  Server tetap jalan, tapi memakai file data.json biasa sebagai cadangan.');
}

function readStore() {
  if (mode === 'sqlite') {
    const row = db.prepare('SELECT payload FROM store WHERE id = 1').get();
    if (!row) return {};
    try { return JSON.parse(row.payload); }
    catch (e) { return {}; }
  }
  try {
    if (!fs.existsSync(JSON_FALLBACK_FILE)) return {};
    return JSON.parse(fs.readFileSync(JSON_FALLBACK_FILE, 'utf8'));
  } catch (e) { return {}; }
}

function writeStore(payload) {
  const json = JSON.stringify(payload);
  if (mode === 'sqlite') {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO store (id, payload, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(json, now);
    return;
  }
  fs.writeFileSync(JSON_FALLBACK_FILE, json);
}

// ---------------------------------------------------------------
// SERVER HTTP
// ---------------------------------------------------------------

// Izinkan akses dari aplikasi desktop (origin berbeda: file:// atau app://)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'app')));

app.get('/api/data', (req, res) => {
  try {
    res.json(readStore());
  } catch (e) {
    console.error('Gagal membaca data:', e);
    res.json({});
  }
});

app.post('/api/data', (req, res) => {
  try {
    writeStore(req.body || {});
    res.json({ ok: true });
  } catch (e) {
    console.error('Gagal menyimpan data:', e);
    res.status(500).json({ ok: false });
  }
});

// Cek sehat, dipakai hosting untuk memastikan server hidup
app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log('Kantin Pintar server berjalan di port ' + PORT);
  console.log(mode === 'sqlite'
    ? 'Database SQLite aktif di: ' + DB_FILE
    : 'Mode cadangan aktif, data disimpan di: ' + JSON_FALLBACK_FILE);
});
