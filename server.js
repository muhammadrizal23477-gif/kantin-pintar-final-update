const express = require('express');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = process.env.PORT || 4000;
const DB_FILE = path.join(__dirname, 'kantin.db');
const OLD_JSON_FILE = path.join(__dirname, 'data.json'); // format lama, dipakai sekali untuk migrasi otomatis

// ---------------------------------------------------------------
// DATABASE (SQLite) — supaya akun (username/password), menu,
// pesanan, dan promo tersimpan permanen di file database asli,
// bukan sekadar file JSON biasa. SQLite menulis secara "atomic"
// jadi jauh lebih tahan terhadap crash/mati listrik di tengah proses
// penyimpanan dibanding menulis file JSON langsung.
// ---------------------------------------------------------------
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL'); // lebih cepat & aman untuk akses bersamaan

db.exec(`
  CREATE TABLE IF NOT EXISTS store (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    payload TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Migrasi otomatis (sekali saja): kalau database masih kosong tapi ada
// data.json peninggalan versi lama, pindahkan isinya ke database baru
// supaya akun & data lama yang sudah ada tidak hilang.
const existingRow = db.prepare('SELECT payload FROM store WHERE id = 1').get();
if (!existingRow && fs.existsSync(OLD_JSON_FILE)) {
  try {
    const legacyContent = fs.readFileSync(OLD_JSON_FILE, 'utf8');
    JSON.parse(legacyContent); // pastikan valid JSON dulu
    db.prepare('INSERT INTO store (id, payload, updated_at) VALUES (1, ?, ?)')
      .run(legacyContent, new Date().toISOString());
    console.log('Data lama dari data.json berhasil dipindahkan ke database SQLite (kantin.db).');
  } catch (e) {
    console.error('Gagal migrasi data.json lama, akan mulai dengan data kosong:', e.message);
  }
}

function readStore() {
  const row = db.prepare('SELECT payload FROM store WHERE id = 1').get();
  if (!row) return {};
  try { return JSON.parse(row.payload); }
  catch (e) { return {}; }
}

function writeStore(payload) {
  const json = JSON.stringify(payload);
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO store (id, payload, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
  `).run(json, now);
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
    console.error('Gagal membaca database:', e);
    res.json({});
  }
});

app.post('/api/data', (req, res) => {
  try {
    writeStore(req.body || {});
    res.json({ ok: true });
  } catch (e) {
    console.error('Gagal menyimpan ke database:', e);
    res.status(500).json({ ok: false });
  }
});

// Cek sehat, dipakai hosting untuk memastikan server hidup
app.get('/health', (req, res) => res.send('OK'));

app.listen(PORT, () => {
  console.log('Kantin Pintar server berjalan di port ' + PORT);
  console.log('Database SQLite aktif di: ' + DB_FILE);
});
