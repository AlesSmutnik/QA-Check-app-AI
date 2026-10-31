'use strict';
require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const db = require('./database');
const app = express();
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false, strictTransportSecurity: false }));
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(18).toString('base64');
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${res.locals.nonce}'; style-src 'self' 'nonce-${res.locals.nonce}'; img-src 'self' blob:; media-src 'self' blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use('/api/workflow', require('./workflow')(db));
app.use(express.json({ limit: '32kb', strict: true }));
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function assert(condition, message) {
  if (!condition) throw new HttpError(400, message);
}
function object(value, keys) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'Očekáván JSON objekt.');
  assert(Object.keys(value).every(key => keys.includes(key)), 'Neznámé pole požadavku.');
}
function text(value, name, max = 100) {
  assert(typeof value === 'string', `${name}: očekáván text.`);
  const result = value.trim();
  assert(result.length > 0 && result.length <= max && !/[\u0000-\u001f\u007f]/u.test(result), `${name}: neplatná délka nebo řídicí znak.`);
  return result;
}
function integer(value, name, max = Number.MAX_SAFE_INTEGER) {
  assert(typeof value === 'string' && /^[1-9]\d*$/.test(value), `${name}: očekáváno kladné celé číslo.`);
  const result = Number(value);
  assert(Number.isSafeInteger(result) && result <= max, `${name}: mimo rozsah.`);
  return result;
}
const findPart = db.prepare('SELECT * FROM parts WHERE id = ?');
const findQr = db.prepare('SELECT * FROM parts WHERE qr_code = ?');
const insertPart = db.prepare('INSERT INTO parts(qr_code, box, pallet, operator_id) VALUES (?, ?, ?, ?)');
const startPart = db.transaction(data => {
  const existing = findQr.get(data.qr_code);
  if (existing) {
    if (existing.box !== data.box || existing.pallet !== data.pallet || existing.operator_id !== data.operator_id) {
      throw new HttpError(409, 'QR již existuje s jiným operátorem, boxem nebo paletou.');
    }
    return { created: false, part: existing };
  }
  const result = insertPart.run(data.qr_code, data.box, data.pallet, data.operator_id);
  return { created: true, part: findPart.get(result.lastInsertRowid) };
});
const checkpoints = db.prepare('SELECT checkpoint_number, status, measured_value FROM checkpoint_results WHERE part_id = ? ORDER BY checkpoint_number');
const upsert = db.prepare(`INSERT INTO checkpoint_results(part_id, checkpoint_number, status, measured_value)
  VALUES (?, ?, ?, ?) ON CONFLICT(part_id, checkpoint_number) DO UPDATE SET
  status = excluded.status, measured_value = excluded.measured_value,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
const updateStatus = db.prepare(`UPDATE parts SET final_status = CASE WHEN
  (SELECT COUNT(*) FROM checkpoint_results WHERE part_id = ? AND status = 'OK') = 30
  THEN 'OK' ELSE 'NOK' END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`);
const saveCheckpoints = db.transaction((id, rows) => {
  if (!findPart.get(id)) throw new HttpError(404, 'Díl neexistuje.');
  for (const row of rows) upsert.run(id, row.checkpoint_number, row.status, row.measured_value);
  updateStatus.run(id, id);
  return { part: findPart.get(id), checkpoints: checkpoints.all(id) };
});
app.post('/api/parts/start', (req, res) => {
  object(req.body, ['qr_code', 'box', 'pallet', 'operator_id']);
  const data = {
    qr_code: text(req.body.qr_code, 'QR', 200),
    box: text(req.body.box, 'Box'),
    pallet: text(req.body.pallet, 'Paleta'),
    operator_id: text(req.body.operator_id, 'Operátor')
  };
  const result = startPart.immediate(data);
  res.status(result.created ? 201 : 200).json({ ...result, checkpoints: checkpoints.all(result.part.id) });
});
app.post('/api/parts/:id/checkpoints', (req, res) => {
  const id = integer(req.params.id, 'ID');
  object(req.body, ['checkpoints']);
  assert(Array.isArray(req.body.checkpoints) && req.body.checkpoints.length >= 1 && req.body.checkpoints.length <= 30, 'Pošlete 1 až 30 bodů.');
  const seen = new Set();
  const rows = req.body.checkpoints.map(row => {
    object(row, ['checkpoint_number', 'status', 'measured_value']);
    assert(Number.isInteger(row.checkpoint_number) && row.checkpoint_number >= 1 && row.checkpoint_number <= 30, 'Bod musí být 1 až 30.');
    assert(!seen.has(row.checkpoint_number), 'Duplicitní číslo bodu.');
    seen.add(row.checkpoint_number);
    assert(row.status === 'OK' || row.status === 'NOK', 'Stav musí být OK nebo NOK.');
    const measured = row.measured_value ?? null;
    assert(measured === null || (typeof measured === 'number' && Number.isFinite(measured)), 'Neplatná naměřená hodnota.');
    return { checkpoint_number: row.checkpoint_number, status: row.status, measured_value: measured };
  });
  res.json(saveCheckpoints.immediate(id, rows));
});
function filters(query, exportMode = false) {
  const allowed = ['qr_code', 'operator_id', 'box', 'pallet', 'final_status', 'from', 'to'];
  assert(Object.keys(query).every(key => allowed.includes(key) || (!exportMode && ['page', 'page_size'].includes(key))), 'Neznámý filtr.');
  const clauses = [], params = [];
  for (const column of ['qr_code', 'operator_id', 'box', 'pallet', 'final_status']) {
    if (query[column] !== undefined) {
      const value = text(query[column], column, column === 'qr_code' ? 200 : 100);
      if (column === 'final_status') assert(['OK', 'NOK'].includes(value), 'Neplatný stav.');
      clauses.push(`p.${column} = ?`);
      params.push(value);
    }
  }
  const dates = {};
  for (const key of ['from', 'to']) {
    if (query[key] !== undefined) {
      const value = query[key];
      assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value)), `${key}: použijte UTC ISO datum.`);
      dates[key] = new Date(value).toISOString();
      assert(dates[key].slice(0, 19) === value.slice(0, 19), 'Neplatné datum.');
      clauses.push(`p.created_at ${key === 'from' ? '>=' : '<'} ?`);
      params.push(dates[key]);
    }
  }
  if (exportMode) assert(dates.from && dates.to, 'Export vyžaduje from a to pro začátek a konec směny.');
  if (dates.from && dates.to) assert(dates.from < dates.to, 'Začátek musí předcházet konci.');
  return { where: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params };
}
const report = db.transaction((where, params, size, offset) => ({
  total: db.prepare(`SELECT COUNT(*) AS total FROM parts p${where}`).get(...params).total,
  items: db.prepare(`SELECT p.*, (SELECT COUNT(*) FROM checkpoint_results c WHERE c.part_id = p.id) AS completed_points
    FROM parts p${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?`).all(...params, size, offset)
}));
app.get('/api/traceability/report', (req, res) => {
  const { where, params } = filters(req.query);
  const page = integer(req.query.page ?? '1', 'page', 1000000);
  const size = integer(req.query.page_size ?? '50', 'page_size', 200);
  res.json({ ...report(where, params, size, (page - 1) * size), page, page_size: size });
});
function csvCell(value) {
  let result = value == null ? '' : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(result)) result = `'${result}`;
  return `"${result.replace(/"/g, '""')}"`;
}
app.get('/api/traceability/export', async (req, res) => {
  const { where, params } = filters(req.query, true);
  // Samostatné spojení zachová konzistentní snapshot i při pomalém stahování.
  const Database = require('better-sqlite3');
  const reader = new Database(db.name, { readonly: true });
  let iterator;
  try {
    reader.exec('BEGIN');
    iterator = reader.prepare(`SELECT p.id, p.qr_code, p.box, p.pallet, p.operator_id,
      p.final_status, p.created_at, p.updated_at, c.checkpoint_number, c.status, c.measured_value
      FROM parts p LEFT JOIN checkpoint_results c ON c.part_id = p.id${where}
      ORDER BY p.created_at, p.id, c.checkpoint_number`).iterate(...params);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="traceability.csv"');
    const columns = ['id', 'qr_code', 'box', 'pallet', 'operator_id', 'final_status', 'created_at', 'updated_at', 'checkpoint_number', 'status', 'measured_value'];
    res.write('\uFEFF' + columns.map(csvCell).join(';') + '\r\n');
    for (const row of iterator) {
      if (res.destroyed) break;
      if (!res.write(columns.map(key => csvCell(row[key])).join(';') + '\r\n')) {
        await once(res, 'drain', { signal: AbortSignal.timeout(30000) });
      }
    }
    res.end();
  } finally {
    if (iterator) iterator.return();
    if (reader.inTransaction) reader.exec('ROLLBACK');
    reader.close();
  }
});
const html = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
app.get('/scanner-protocol.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'scanner-protocol.js')));
app.get('/admin.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.js')));
app.get('/camera-scanner.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'camera-scanner.js')));
app.get('/photo-decoder.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'photo-decoder.js')));
app.get('/scanner-console.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'scanner-console.js')));
app.get('/box-ui.js', (req, res) => res.sendFile(path.join(__dirname, 'public', 'box-ui.js')));
app.get('/styles.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'styles.css')));
app.get('/vendor/jsqr.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules', 'jsqr', 'dist', 'jsQR.js')));
app.get('/camera-test', (req, res) => res.sendFile(path.join(__dirname, 'public', 'camera-test.html')));
app.get('/vendor/zxing.js', (req, res) => res.sendFile(path.join(__dirname, 'node_modules', '@zxing', 'library', 'umd', 'index.min.js')));
app.get('/', (req, res) => res.type('html').send(html.replaceAll('__NONCE__', res.locals.nonce)));
app.use((req, res, next) => next(new HttpError(404, 'Nenalezeno.')));
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = err instanceof HttpError ? err.status : 500;
  let message = err instanceof HttpError ? err.message : 'Interní chyba serveru.';
  if (err.type === 'entity.parse.failed') { status = 400; message = 'Neplatný JSON.'; }
  if (err.type === 'entity.too.large') { status = 413; message = 'Požadavek je příliš velký.'; }
  if (err.code === 'SQLITE_BUSY') { status = 503; message = 'Databáze je zaneprázdněná. Opakujte požadavek.'; }
  if (status >= 500) console.error({ event: 'request_failed', code: err.code || err.name });
  const response = { error: message };
  if (process.env.NODE_ENV !== 'production') response.details = err.stack;
  res.status(status).json(response);
});
if (require.main === module) {
  const port = Number(process.env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Neplatný PORT.');
  const server = app.listen(port, process.env.HOST || '0.0.0.0');
  server.once('listening', () => console.log(`Traceability Firewall běží: http://localhost:${port}`));
  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Port ${port} je již obsazený. Pokud aplikace už běží, otevřete http://localhost:${port}. Pro restart nejdříve zastavte původní server pomocí Ctrl+C v jeho terminálu. Jinak nastavte jiný PORT v .env.`);
    } else {
      console.error(`Server se nepodařilo spustit (${err.code || 'UNKNOWN'}).`);
    }
    db.close();
    process.exitCode = 1;
  });
  const shutdown = () => {
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
module.exports = app;
