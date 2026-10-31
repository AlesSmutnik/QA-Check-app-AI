'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'traceability-test-'));
process.env.DATABASE_PATH = path.join(folder,'test.sqlite');
process.env.NODE_ENV = 'production';
process.env.ADMIN_KEY = crypto.randomBytes(32).toString('hex');
const app = require('../server');
const db = require('../database');

test('Řízená kontrola: role, pořadí, NOK, oprava, souběh, idempotence a rollback', async () => {
  const server = app.listen(0,'127.0.0.1');
  await new Promise(resolve => server.once('listening',resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/workflow`;
  async function request(route, body, admin = false) {
    const headers = {'Content-Type':'application/json'};
    if(admin) headers.Authorization = `Bearer ${process.env.ADMIN_KEY}`;
    const response = await fetch(base+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});
    return { status:response.status, data:await response.json() };
  }
  try {
    const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
    new (require('node:vm').Script)(html.match(/<script nonce="__NONCE__">([\s\S]*?)<\/script>/)[1]);
    assert.equal((await request('/admin/projects')).status,401);
    const payload={name:'TEST · revize 1',steps:[{title:'Vizuální kontrola',instruction:'Zkontrolovat povrch.',kind:'visual',rule:'part',rework_instruction:'Odstranit otřep.'},{title:'Komponent',instruction:'Naskenovat komponent.',kind:'scan',rule:'exact',expected:'COMPONENT-1',rework_instruction:''}]};
    const created=await request('/admin/projects',payload,true);assert.equal(created.status,201);const projectId=created.data.id;
    assert.deepEqual((await request('/projects')).data,[]);
    const start=async qr=>request('/runs/start',{project_id:projectId,qr_code:qr,operator_id:'OP',box:'B',pallet:'P'});
    assert.equal((await start('PART-1')).status,409);
    assert.equal((await request(`/admin/projects/${projectId}/publish`,{},true)).status,200);
    let run=(await start('PART-1')).data;
    const action=(run, action, scanned_value, request_id=crypto.randomUUID())=>request(`/runs/${run.id}/actions`,{request_id,version:run.version,action,scanned_value});
    const requestId=crypto.randomUUID();
    const first=await action(run,'nok',undefined,requestId);assert.equal(first.data.run.state,'VERIFY');assert.equal(first.data.run.position,1);
    assert.deepEqual((await action(run,'nok',undefined,requestId)).data,first.data);
    assert.equal((await action(run,'scan','PART-1',requestId)).status,409);
    assert.equal((await action(run,'scan','PART-1')).status,409);
    run=first.data.run;run=(await action(run,'rework')).data.run;assert.equal(run.state,'REWORK');
    assert.equal((await action(run,'scan','PART-1')).status,409);
    assert.equal((await action(run,'rework_done','WRONG')).status,400);
    run=(await action(run,'rework_done','PART-1')).data.run;assert.equal(run.position,1);assert.equal(run.state,'VERIFY');
    run=(await action(run,'scan','PART-1')).data.run;assert.equal(run.position,2);assert.equal(run.state,'INSPECT');
    assert.equal((await action(run,'rework')).status,400);
    run=(await action(run,'scan','WRONG-COMPONENT')).data.run;assert.equal(run.state,'VERIFY');
    run=(await action(run,'scan','COMPONENT-1')).data.run;assert.equal(run.state,'OK');assert.equal(run.step,null);
    assert.equal((await action(run,'nok')).status,409);
    assert.equal((await start('PART-1')).data.state,'OK');
    let rejected=(await start('PART-2')).data;
    rejected=(await action(rejected,'nok')).data.run;rejected=(await action(rejected,'nok')).data.run;assert.equal(rejected.state,'NOK');assert.equal(rejected.position,1);
    let concurrent=(await start('PART-3')).data;
    const results=await Promise.all([action(concurrent,'scan','PART-3'),action(concurrent,'scan','PART-3')]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    const rollback=(await start('PART-4')).data;
    db.exec(`CREATE TEMP TRIGGER wf_test_fail BEFORE INSERT ON wf_events BEGIN SELECT RAISE(ABORT,'forced test failure'); END`);
    const failed=await action(rollback,'scan','PART-4');assert.equal(failed.status,500);assert.equal(failed.data.details,undefined);
    assert.equal(db.prepare('SELECT version FROM wf_runs WHERE id=?').get(rollback.id).version,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wf_events WHERE run_id=?').get(rollback.id).n,0);db.exec('DROP TRIGGER wf_test_fail');
    assert.equal((await request('/admin/projects',{...payload,steps:[{...payload.steps[0],image_id:999999}]},true)).status,400);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wf_projects').get().n,1);
    const presence=await request('/admin/projects',{name:'Přítomnost',steps:[{title:'Štítek',instruction:'Ověřte přítomnost štítku.',kind:'scan',rule:'presence',rework_instruction:''}]},true);
    await request(`/admin/projects/${presence.data.id}/publish`,{},true);
    const presenceRun=(await request('/runs/start',{project_id:presence.data.id,qr_code:'PRESENCE-1',operator_id:'OP',box:'B',pallet:'P'})).data;
    assert.equal((await action(presenceRun,'scan','LOT:2026-10')).data.run.state,'OK');
    assert.equal((await request('/admin/images',{data:'data:image/png;base64,YmFk'},true)).status,400);
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
    const image=await request('/admin/images',{data:'data:image/png;base64,'+png},true);assert.equal(image.status,201);
    const imageResponse=await fetch(base+`/images/${image.data.id}`);assert.equal(imageResponse.headers.get('content-type'),'image/png');
    assert.equal((await request('/admin/report',undefined,true)).data.total,5);
    const events=(await request(`/admin/runs/${run.id}/events`,undefined,true)).data;assert.equal(events.length,6);assert.equal(events[0].result,'NOK');
    const scanner=require('../public/scanner-protocol');
    for(const [code,expected] of [['0','ok'],['1','nok'],['R','rework']]) {
      for(const suffix of ['','\r','\n','\r\n']) assert.equal(scanner.command(code+suffix),expected);
    }
    assert.equal(scanner.command('toString'),null);
    assert.equal(scanner.command('10'),null);
    assert.equal(scanner.command('R-PART'),null);
    // Ověření skutečného submit handleru bez prohlížeče: druhý Enter,
    // blokování za běhu a odlišení potvrzení opravy od výsledku kroku.
    const handler=html.match(/\$\('stepForm'\)\.onsubmit=([^\n]+)/)[0];
    for(const sample of [
      {value:'',state:'INSPECT',busy:false,pending:null,expected:null},
      {value:'1',state:'INSPECT',busy:true,pending:null,expected:null},
      {value:'1',state:'INSPECT',busy:false,pending:{},expected:null},
      {value:'0',state:'INSPECT',busy:false,pending:null,expected:'scan'},
      {value:'0',state:'REWORK',busy:false,pending:null,expected:'scan'},
      {value:'PART',state:'REWORK',busy:false,pending:null,expected:'rework_done'}
    ]) {
      const form={}, input={value:sample.value}, calls=[];
      const context={$:name=>name==='stepForm'?form:input,busy:sample.busy,pending:sample.pending,current:{state:sample.state},ScannerProtocol:scanner,task:fn=>fn(),sendAction:(...args)=>calls.push(args)};
      require('node:vm').runInNewContext(handler,context);
      form.onsubmit({preventDefault(){}});
      assert.equal(calls[0]?.[0] ?? null,sample.expected);
    }
    assert.equal((await start('0')).status,400);
    const adminReserved={name:'Kolize',steps:[{...payload.steps[1],expected:'1'}]};
    assert.equal((await request('/admin/projects',adminReserved,true)).status,400);
    let controlled=(await start('QR-CONTROL')).data;
    controlled=(await action(controlled,'scan','R\r')).data.run;assert.equal(controlled.state,'REWORK');
    assert.equal((await action(controlled,'scan','1\r')).status,409);
    controlled=(await action(controlled,'scan','0\r')).data.run;assert.equal(controlled.state,'INSPECT');assert.equal(controlled.position,1);
    const confirmId=crypto.randomUUID();
    const confirm=await action(controlled,'scan','0\r',confirmId);assert.equal(confirm.data.run.position,2);
    assert.deepEqual((await action(controlled,'scan','0\r',confirmId)).data,confirm.data);
    controlled=confirm.data.run;
    assert.equal((await action(controlled,'scan','0\r')).status,409);
    assert.equal((await action(controlled,'scan','COMPONENT-1\r\n')).data.run.state,'OK');
    let bad=(await start('QR-REJECT')).data;
    bad=(await action(bad,'scan','1')).data.run;assert.equal(bad.state,'VERIFY');
    bad=(await action(bad,'scan','1\r')).data.run;assert.equal(bad.state,'NOK');
    const presence2=(await request('/runs/start',{project_id:presence.data.id,qr_code:'PRESENCE-2',operator_id:'OP',box:'B',pallet:'P'})).data;
    assert.equal((await action(presence2,'scan','0')).status,409);
    assert.equal((await action(presence2,'scan','R')).status,400);
    assert.equal((await action(presence2,'scan','1')).data.run.state,'VERIFY');
    const history=(await request(`/admin/runs/${bad.id}/events`,undefined,true)).data;
    assert.equal(history[1].scanned_value,'1\r');assert.equal(history[1].excel_code,'1');
    const ctrl=(await start('CTRL-CHAR')).data;
    assert.equal((await action(ctrl,'scan','0\u0000')).status,400);
    const client=await fetch(base.replace('/api/workflow','')+'/scanner-protocol.js');assert.equal(client.status,200);assert.match(await client.text(),/ScannerProtocol/);
  } finally {
    await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(folder,{recursive:true,force:true});
  }
});
