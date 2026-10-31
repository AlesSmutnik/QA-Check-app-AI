'use strict';
const express = require('express');
const crypto = require('node:crypto');
const scanner = require('./public/scanner-protocol');

module.exports = function workflow(db) {
  const router = express.Router();
  class Fault extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }
  const check = (condition, message, status = 400) => {
    if (!condition) throw new Fault(status, message);
  };
  const string = (value, name, max = 200) => {
    check(typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max && !/[\u0000-\u001f\u007f]/u.test(value), `Neplatné pole: ${name}.`);
    return value.trim();
  };
  const id = value => {
    check(/^[1-9]\d*$/.test(String(value)) && Number.isSafeInteger(Number(value)), 'Neplatné ID.');
    return Number(value);
  };
  const shape = (value, keys) => check(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)), 'Neplatná struktura požadavku.');
  const catalog=require('./scan-catalog')(db);
  router.get('/scan-catalog',(req,res)=>res.json(catalog.list()));
  router.post('/scan/inspect',express.json({limit:'4kb'}),(req,res)=>{
    shape(req.body,['value']);check(typeof req.body.value==='string'&&req.body.value.length>0&&req.body.value.length<=502,'Neplatný sken.');
    const canonical=string(scanner.normalize(req.body.value),'Sken',500),matched=catalog.resolve(req.body.value);
    res.json({raw:req.body.value,hex:Buffer.from(req.body.value,'utf8').toString('hex'),canonical,action:matched?.action||null,known:Boolean(matched)});
  });
  db.transaction(() => db.exec(`
    CREATE TABLE IF NOT EXISTS wf_images (
      id INTEGER PRIMARY KEY, mime TEXT NOT NULL, bytes BLOB NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS wf_projects (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 0 CHECK(published IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ) STRICT;
    CREATE TABLE IF NOT EXISTS wf_steps (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES wf_projects(id),
      position INTEGER NOT NULL CHECK(position > 0), title TEXT NOT NULL,
      instruction TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('visual','scan')),
      rule TEXT NOT NULL CHECK(rule IN ('part','exact','presence')),
      expected TEXT, image_id INTEGER REFERENCES wf_images(id),
      rework_instruction TEXT NOT NULL, UNIQUE(project_id, position)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS wf_runs (
      id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES wf_projects(id),
      qr_code TEXT NOT NULL, operator_id TEXT NOT NULL, box TEXT NOT NULL, pallet TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 1, version INTEGER NOT NULL DEFAULT 0,
      failures INTEGER NOT NULL DEFAULT 0 CHECK(failures BETWEEN 0 AND 2),
      state TEXT NOT NULL DEFAULT 'INSPECT' CHECK(state IN ('INSPECT','VERIFY','REWORK','OK','NOK')),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(project_id, qr_code)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS wf_events (
      id INTEGER PRIMARY KEY, run_id INTEGER NOT NULL REFERENCES wf_runs(id),
      request_id TEXT NOT NULL, payload TEXT NOT NULL, response TEXT NOT NULL,
      position INTEGER NOT NULL, action TEXT NOT NULL, result TEXT NOT NULL,
      scanned_value TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      UNIQUE(run_id, request_id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS wf_runs_project_date ON wf_runs(project_id, created_at, id);
    CREATE INDEX IF NOT EXISTS wf_events_run ON wf_events(run_id, id);
  `))();
  // Aditivní migrace: staré projekty, kroky a historie zůstávají zachované.
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS wf_customers (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
      contact TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ) STRICT;`);
    const add = (table, column, definition) => {
      if (!db.pragma(`table_info(${table})`).some(item => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    };
    add('wf_projects','customer_id','INTEGER REFERENCES wf_customers(id)');
    add('wf_projects','code',"TEXT NOT NULL DEFAULT ''");
    add('wf_projects','description',"TEXT NOT NULL DEFAULT ''");
    for(const table of ['wf_customers','wf_projects']) {
      add(table,'deleted_at','TEXT');
      add(table,'delete_batch','TEXT');
    }
    add('wf_steps','verification_type',"TEXT CHECK(verification_type IN ('visual','qr','bar','measurement'))");
    add('wf_steps','min_value','REAL'); add('wf_steps','max_value','REAL');
    add('wf_steps','unit',"TEXT NOT NULL DEFAULT ''");
    add('wf_events','measured_value','REAL');
    db.exec('CREATE INDEX IF NOT EXISTS wf_projects_customer ON wf_projects(customer_id, id)');
  })();
  router.use(express.json({ limit: '6mb', strict: true }));
  router.use('/admin', (req, res, next) => {
    const configured = process.env.ADMIN_KEY;
    if (!configured || configured.length < 32) return next(new Fault(503, 'Administrace vyžaduje ADMIN_KEY o délce alespoň 32 znaků v .env.'));
    const supplied = req.get('Authorization') || '';
    const hash = value => crypto.createHash('sha256').update(value).digest();
    if (!crypto.timingSafeEqual(hash(supplied), hash(`Bearer ${configured}`))) return next(new Fault(401, 'Neplatný přístupový klíč administrátora.'));
    next();
  });
  const project = db.prepare('SELECT * FROM wf_projects WHERE id = ?');
  const steps = db.prepare(`SELECT s.*, i.mime AS image_mime,
    COALESCE(s.verification_type, CASE s.kind WHEN 'visual' THEN 'visual' ELSE 'qr' END) AS verification_type
    FROM wf_steps s LEFT JOIN wf_images i ON i.id = s.image_id WHERE s.project_id = ? ORDER BY s.position`);
  const runById = db.prepare('SELECT * FROM wf_runs WHERE id = ?');
  const boxes=require('./box-tracking')(router,db,check,string,id,shape);
  function view(run) {
    const list = steps.all(run.project_id);
    return { ...run, box_progress:boxes.summary(run.project_id,run.pallet,run.box), total_steps: list.length, step: ['OK','NOK'].includes(run.state) ? null : list.find(step => step.position === run.position) };
  }
  router.get('/projects', (req, res) => res.json(db.prepare('SELECT id, name FROM wf_projects WHERE published = 1 AND deleted_at IS NULL ORDER BY id DESC').all()));
  router.get('/images/:id', (req, res) => {
    const image = db.prepare('SELECT mime, bytes FROM wf_images WHERE id = ?').get(id(req.params.id));
    check(image, 'Fotografie neexistuje.', 404);
    res.type(image.mime).send(image.bytes);
  });
  router.get('/admin/projects', (req, res) => res.json(db.prepare(`SELECT p.*, c.name AS customer_name,
    (SELECT COUNT(*) FROM wf_steps WHERE project_id = p.id) AS step_count,
    (SELECT COUNT(*) FROM wf_runs WHERE project_id = p.id) AS run_count
    FROM wf_projects p LEFT JOIN wf_customers c ON c.id = p.customer_id
    WHERE (? = 1 OR p.deleted_at IS NULL) ORDER BY p.id DESC`).all(req.query.include_deleted === '1' ? 1 : 0)));
  router.get('/admin/customers', (req, res) => res.json(db.prepare('SELECT * FROM wf_customers WHERE (? = 1 OR deleted_at IS NULL) ORDER BY name, id').all(req.query.include_deleted === '1' ? 1 : 0)));
  const trash = db.transaction((type, recordId, restore) => {
    const table = type === 'customer' ? 'wf_customers' : 'wf_projects';
    const record = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(recordId);
    check(record, 'Záznam neexistuje.',404);
    if(restore) {
      if(!record.deleted_at) return { restored: true };
      if(type === 'project' && record.customer_id) check(!db.prepare('SELECT deleted_at FROM wf_customers WHERE id = ?').get(record.customer_id)?.deleted_at,'Nejdříve obnovte firmu.',409);
      if(type === 'customer') db.prepare('UPDATE wf_projects SET deleted_at = NULL, delete_batch = NULL WHERE customer_id = ? AND delete_batch = ?').run(recordId,record.delete_batch);
      db.prepare(`UPDATE ${table} SET deleted_at = NULL, delete_batch = NULL WHERE id = ?`).run(recordId);
      return { restored: true };
    }
    if(record.deleted_at) return { deleted: true };
    const timestamp = new Date().toISOString(), batch = crypto.randomUUID();
    if(type === 'customer') db.prepare('UPDATE wf_projects SET deleted_at = ?, delete_batch = ? WHERE customer_id = ? AND deleted_at IS NULL').run(timestamp,batch,recordId);
    db.prepare(`UPDATE ${table} SET deleted_at = ?, delete_batch = ? WHERE id = ?`).run(timestamp,batch,recordId);
    return { deleted: true };
  });
  for(const [path,type] of [['customers','customer'],['projects','project']]) {
    router.post(`/admin/${path}/:id/delete`,(req,res)=>{shape(req.body,[]);res.json(trash.immediate(type,id(req.params.id),false));});
    router.post(`/admin/${path}/:id/restore`,(req,res)=>{shape(req.body,[]);res.json(trash.immediate(type,id(req.params.id),true));});
  }
  function saveCustomer(req, res) {
    shape(req.body, ['name','code','contact','email','notes']);
    const name = string(req.body.name,'Zákazník');
    const code = string(req.body.code,'Kód zákazníka',80);
    const optional = (value, label, max) => value == null || value === '' ? '' : string(value,label,max);
    const contact = optional(req.body.contact,'Kontakt',200), email = optional(req.body.email,'Email',200), notes = optional(req.body.notes,'Poznámka',4000);
    check(!email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Neplatný email.');
    try {
      if(req.params.id) {
        const customerId=id(req.params.id);
        const customer = db.prepare('SELECT deleted_at FROM wf_customers WHERE id=?').get(customerId);
        check(customer,'Zákazník neexistuje.',404);
        check(!customer.deleted_at,'Zákazník je v Koši. Nejdříve jej obnovte.',409);
        db.prepare('UPDATE wf_customers SET name=?, code=?, contact=?, email=?, notes=? WHERE id=?').run(name,code,contact,email,notes,customerId);
        return res.json(db.prepare('SELECT * FROM wf_customers WHERE id=?').get(customerId));
      }
      const result = db.prepare('INSERT INTO wf_customers(name, code, contact, email, notes) VALUES (?, ?, ?, ?, ?)').run(name,code,contact,email,notes);
      res.status(201).json(db.prepare('SELECT * FROM wf_customers WHERE id = ?').get(result.lastInsertRowid));
    } catch(error) { if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') throw new Fault(409,'Kód zákazníka již existuje.'); throw error; }
  }
  router.post('/admin/customers', saveCustomer);
  router.post('/admin/customers/:id', saveCustomer);
  router.post('/admin/images', (req, res) => {
    shape(req.body, ['data']);
    check(typeof req.body.data === 'string', 'Chybí fotografie.');
    const match = /^data:(image\/(?:png|jpeg)|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/.exec(req.body.data);
    check(match, 'Povoleny jsou PNG, JPEG a PDF výkresy.');
    const bytes = Buffer.from(match[2], 'base64');
    check(bytes.length > 8 && bytes.length <= 4 * 1024 * 1024, 'Fotografie musí mít nejvýše 4 MB.');
    check(match[1] === 'image/png' ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) : match[1] === 'application/pdf' ? bytes.subarray(0,5).toString() === '%PDF-' : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255, 'Obsah neodpovídá typu přílohy.');
    res.status(201).json({ id: Number(db.prepare('INSERT INTO wf_images(mime, bytes) VALUES (?, ?)').run(match[1], bytes).lastInsertRowid) });
  });
  const createProject = db.transaction((name, list, metadata) => {
    if(metadata.customer_id) {
      const customer = db.prepare('SELECT deleted_at FROM wf_customers WHERE id = ?').get(metadata.customer_id);
      check(customer,'Zákazník neexistuje.',404);
      check(!customer.deleted_at,'Nelze přidat projekt do smazané firmy.',409);
    }
    const projectId = Number(db.prepare('INSERT INTO wf_projects(name, customer_id, code, description) VALUES (?, ?, ?, ?)').run(name,metadata.customer_id,metadata.code,metadata.description).lastInsertRowid);
    const insert = db.prepare(`INSERT INTO wf_steps(project_id, position, title, instruction, kind, rule, expected, image_id, rework_instruction, verification_type, min_value, max_value, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    list.forEach((step, index) => {
      if (step.image_id) check(db.prepare('SELECT id FROM wf_images WHERE id = ?').get(step.image_id), 'Fotografie neexistuje.');
      insert.run(projectId, index + 1, step.title, step.instruction, step.kind, step.rule, step.expected, step.image_id, step.rework_instruction, step.verification_type, step.min_value, step.max_value, step.unit);
    });
    return project.get(projectId);
  });
  router.post('/admin/projects', (req, res) => {
    shape(req.body, ['name','steps','customer_id','code','description']);
    const name = string(req.body.name, 'Název projektu');
    const metadata = { customer_id: req.body.customer_id == null ? null : id(req.body.customer_id), code: req.body.code ? string(req.body.code,'Kód projektu',100) : '', description: req.body.description ? string(req.body.description,'Popis projektu',4000) : '' };
    check(Array.isArray(req.body.steps) && req.body.steps.length >= 1 && req.body.steps.length <= 100, 'Postup musí obsahovat 1 až 100 kroků.');
    const list = req.body.steps.map(step => {
      shape(step, ['title','instruction','kind','rule','expected','image_id','rework_instruction','verification_type','min_value','max_value','unit']);
      const type = step.verification_type ?? (step.kind === 'visual' ? 'visual' : 'qr');
      check(['visual','qr','bar','measurement'].includes(type),'Neplatný typ ověření.');
      const kind = type === 'visual' ? 'visual' : 'scan';
      check(step.kind === undefined || step.kind === kind, 'Neplatný typ kroku.');
      check(['part','exact','presence'].includes(step.rule), 'Neplatné pravidlo skenu.');
      check(kind !== 'visual' || step.rule === 'part', 'Vizuální kontrolu potvrzuje QR dílu.');
      if(type === 'measurement') check(typeof step.min_value === 'number' && Number.isFinite(step.min_value) && typeof step.max_value === 'number' && Number.isFinite(step.max_value) && step.min_value <= step.max_value,'Měření vyžaduje platnou dolní a horní mez.');
      return {
        title: string(step.title, 'Název kroku'), instruction: string(step.instruction, 'Pokyn', 4000),
        kind, rule: type === 'measurement' ? 'presence' : step.rule,
        expected: type !== 'measurement' && step.rule === 'exact' ? string(step.expected, 'Očekávaný kód', 500) : null,
        verification_type: type, min_value: type === 'measurement' ? step.min_value : null, max_value: type === 'measurement' ? step.max_value : null,
        unit: step.unit ? string(step.unit,'Jednotka',30) : '',
        image_id: step.image_id == null ? null : id(step.image_id),
        rework_instruction: step.rework_instruction ? string(step.rework_instruction, 'Oprava', 4000) : ''
      };
    });
    check(list.every(step => !catalog.command(step.expected)), 'Kódy 0, 1 a R jsou vyhrazeny pro ovládání kontroly.');
    res.status(201).json(createProject.immediate(name, list, metadata));
  });
  router.get('/admin/projects/:id', (req, res) => {
    const found = project.get(id(req.params.id));
    check(found, 'Projekt neexistuje.', 404);
    res.json({ ...found, steps: steps.all(found.id) });
  });
  router.post('/admin/projects/:id/publish', (req, res) => {
    const projectId = id(req.params.id);
    check(project.get(projectId), 'Projekt neexistuje.', 404);
    check(!project.get(projectId).deleted_at,'Projekt je v Koši. Nejdříve jej obnovte.',409);
    db.prepare('UPDATE wf_projects SET published = 1 WHERE id = ?').run(projectId);
    res.json(project.get(projectId));
  });
  const start = db.transaction(data => {
    check(project.get(data.project_id)?.published === 1, 'Projekt není zveřejněný.', 409);
    const existing = db.prepare('SELECT * FROM wf_runs WHERE project_id = ? AND qr_code = ?').get(data.project_id, data.qr_code);
    if (existing) {
      check(existing.operator_id === data.operator_id && existing.box === data.box && existing.pallet === data.pallet, 'Díl je přiřazen jinému operátorovi, boxu nebo paletě.', 409);
      return view(existing);
    }
    check(!project.get(data.project_id).deleted_at,'Projekt byl přesunut do Koše. Novou kontrolu nelze zahájit.',409);
    boxes.assertSpace(data.project_id,data.pallet,data.box);
    const result = db.prepare('INSERT INTO wf_runs(project_id, qr_code, operator_id, box, pallet) VALUES (?, ?, ?, ?, ?)').run(data.project_id, data.qr_code, data.operator_id, data.box, data.pallet);
    return view(runById.get(result.lastInsertRowid));
  });
  router.post('/runs/start', (req, res) => {
    shape(req.body, ['project_id','qr_code','operator_id','box','pallet']);
    const data={ project_id: id(req.body.project_id), qr_code: string(req.body.qr_code, 'QR dílu'), operator_id: string(req.body.operator_id, 'Operátor',100), box: string(req.body.box,'Box',100), pallet: string(req.body.pallet,'Paleta',100) };
    for(const field of ['qr_code','operator_id'])check(!catalog.command(data[field]),'Naskenován řídicí QR. Zde je nutný identifikátor dílu nebo operátora.');
    res.json(start.immediate(data));
  });
  const act = db.transaction((runId, body) => {
    const requestData = { version: body.version, action: body.action, scanned_value: body.scanned_value ?? null };
    if(body.action === 'measure') requestData.measured_value = body.measured_value;
    const payload = JSON.stringify(requestData);
    const previous = db.prepare('SELECT * FROM wf_events WHERE run_id = ? AND request_id = ?').get(runId, body.request_id);
    if (previous) {
      check(previous.payload === payload, 'ID požadavku již bylo použito pro jiná data.',409);
      return JSON.parse(previous.response);
    }
    const run = runById.get(runId);
    check(run, 'Kontrola neexistuje.',404);
    check(run.version === body.version, 'Kontrola již byla změněna. Načtěte ji znovu skenem dílu.',409);
    check(!['OK','NOK'].includes(run.state), 'Díl je již uzavřen.',409);
    const step = steps.all(run.project_id).find(item => item.position === run.position);
    let state = run.state, position = run.position, failures = run.failures, result;
    const command = body.action === 'scan' ? catalog.command(body.scanned_value) : null;
    if (state === 'REWORK') {
      check(body.action === 'rework_done' || (body.action === 'scan' && command === 'ok'), 'Nejdříve dokončete opravu a potvrďte ji QR OK (0).',409);
      if (body.action === 'rework_done') check(scanner.normalize(body.scanned_value) === run.qr_code, 'Dokončení opravy potvrďte QR stejného dílu.');
      state = failures ? 'VERIFY' : 'INSPECT';
      result = 'REWORK_DONE';
    } else if (body.action === 'rework' || command === 'rework') {
      check(step.rework_instruction.length > 0, 'Pro tento krok není oprava povolena.');
      state = 'REWORK';
      result = 'REWORK';
    } else {
      check(['scan','nok','measure'].includes(body.action), 'Nepovolená akce.');
      let ok = false;
      if(body.action === 'measure') {
        check(step.verification_type === 'measurement','Tento krok není měření.',409);
        ok = body.measured_value >= step.min_value && body.measured_value <= step.max_value;
      } else if (body.action === 'scan') {
        check(step.verification_type !== 'measurement' || command === 'nok','Tento krok vyžaduje naměřenou hodnotu.',409);
        const scanned = string(scanner.normalize(body.scanned_value), 'Sken',500);
        if (command === 'ok') {
          check(step.kind === 'visual', 'Tento krok vyžaduje sken kontrolovaného kódu. QR OK jej nenahrazuje.',409);
          ok = true;
        } else if (command !== 'nok') {
          ok = step.rule === 'part' ? scanned === run.qr_code : step.rule === 'exact' ? scanned === step.expected : scanned.length > 0;
        }
      }
      result = ok ? 'OK' : 'NOK';
      if (ok) {
        position++;
        failures = 0;
        state = position > steps.all(run.project_id).length ? 'OK' : 'INSPECT';
      } else {
        failures++;
        state = failures >= 2 ? 'NOK' : 'VERIFY';
      }
    }
    db.prepare(`UPDATE wf_runs SET position = ?, failures = ?, state = ?, version = version + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(position, failures, state, runId);
    const response = { run: view(runById.get(runId)), result };
    db.prepare('INSERT INTO wf_events(run_id, request_id, payload, response, position, action, result, scanned_value, measured_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(runId, body.request_id, payload, JSON.stringify(response), run.position, body.action, result, body.scanned_value ?? null, body.measured_value ?? null);
    return response;
  });
  router.post('/runs/:id/actions', (req, res) => {
    shape(req.body, ['request_id','version','action','scanned_value','measured_value']);
    string(req.body.request_id,'ID požadavku',100);
    check(Number.isSafeInteger(req.body.version) && req.body.version >= 0, 'Neplatná verze.');
    check(['scan','nok','rework','rework_done','measure'].includes(req.body.action), 'Neplatná akce.');
    if(req.body.action === 'measure') check(typeof req.body.measured_value === 'number' && Number.isFinite(req.body.measured_value),'Naměřená hodnota musí být konečné číslo.');
    else check(req.body.measured_value == null,'Naměřená hodnota patří pouze k měření.');
    if (req.body.scanned_value != null) {
      check(typeof req.body.scanned_value === 'string' && req.body.scanned_value.length <= 502, 'Neplatný sken.');
      string(scanner.normalize(req.body.scanned_value), 'Sken',500);
    }
    res.json(act.immediate(id(req.params.id), req.body));
  });
  router.get('/admin/report', (req, res) => {
    const page = req.query.page === undefined ? 1 : id(req.query.page);
    check(page <= 1000000, 'Stránka mimo rozsah.');
    res.json({ page, page_size: 50, total: db.prepare('SELECT COUNT(*) AS n FROM wf_runs').get().n,
      items: db.prepare('SELECT r.*, p.name AS project_name FROM wf_runs r JOIN wf_projects p ON p.id = r.project_id ORDER BY r.id DESC LIMIT ? OFFSET ?').all(50, (page - 1) * 50) });
  });
  router.get('/admin/runs/:id/events', (req, res) => {
    res.json(db.prepare(`SELECT id, position, action, result, scanned_value, measured_value, created_at,
      CASE result WHEN 'OK' THEN '0' WHEN 'NOK' THEN '1' WHEN 'REWORK' THEN 'R' ELSE NULL END AS excel_code
      FROM wf_events WHERE run_id = ? ORDER BY id`).all(id(req.params.id)));
  });
  require('./project-export')(router, db, check, id);
  router.use((err, req, res, next) => {
    if (err instanceof Fault) return res.status(err.status).json({ error: err.message });
    next(err);
  });
  return router;
};
