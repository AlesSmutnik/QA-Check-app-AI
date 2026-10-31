'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const ExcelJS=require('exceljs');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'traceability-admin-'));
process.env.DATABASE_PATH=path.join(folder,'test.sqlite');process.env.NODE_ENV='production';process.env.ADMIN_KEY=crypto.randomBytes(32).toString('hex');
const db=require('../database');
// Simulace existujícího projektu před aditivní migrací.
db.exec(`CREATE TABLE wf_projects(id INTEGER PRIMARY KEY, name TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT '2026-01-01T00:00:00.000Z') STRICT;
 CREATE TABLE wf_steps(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES wf_projects(id), position INTEGER NOT NULL, title TEXT NOT NULL, instruction TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('visual','scan')), rule TEXT NOT NULL, expected TEXT, image_id INTEGER, rework_instruction TEXT NOT NULL, UNIQUE(project_id,position)) STRICT;
 INSERT INTO wf_projects(name) VALUES ('Původní projekt');
 INSERT INTO wf_steps(project_id,position,title,instruction,kind,rule,rework_instruction) VALUES(1,1,'Původní vada','Pokyn','visual','part','');`);
const app=require('../server');
test('Administrace zákazníků, migrace, měření a exporty',async t=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function raw(route,body,admin=true){const headers={};if(admin)headers.Authorization=`Bearer ${process.env.ADMIN_KEY}`;if(body!==undefined)headers['Content-Type']='application/json';return fetch(base+'/api/workflow'+route,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)});}
 async function api(route,body,admin=true){const res=await raw(route,body,admin);return {status:res.status,data:await res.json()};}
 const visual={title:'Povrch',instruction:'Zkontrolovat povrch.',verification_type:'visual',rule:'part',rework_instruction:'Opravit povrch.'};
 let customerA,customerB,project,partial;
 const start=async(qr,p=project)=>{const res=await api('/runs/start',{project_id:p.id,qr_code:qr,operator_id:'OP',box:'BOX-001',pallet:'PAL-001'},false);assert.equal(res.status,200);return res.data;};
 const act=async(run,action,values={})=>api(`/runs/${run.id}/actions`,{request_id:crypto.randomUUID(),version:run.version,action,...values},false);
 try {
 await t.test('Migrace zachovává původní data a přiřadí zpětně kompatibilní typ',async()=>{
   const catalog=(await api('/scan-catalog',undefined,false)).data;assert.equal(catalog.images.length,7);assert.equal(catalog.codes.length,6);assert.equal(catalog.images.reduce((n,i)=>n+i.decoded.length,0),9);
   for(const [value,action] of [['0','ok'],['0\r','ok'],['1\r\n','nok'],['R','rework'],['R\r','rework'],['10',null],['r',null],['R123',null]]){const result=await api('/scan/inspect',{value},false);assert.equal(result.status,200);assert.equal(result.data.action,action);}
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wf_runs').get().n,0);
   const old=await api('/admin/projects/1');assert.equal(old.data.name,'Původní projekt');assert.equal(old.data.customer_id,null);assert.equal(old.data.steps[0].verification_type,'visual');
   const page=await fetch(base+'/');assert.equal(page.status,200);const html=await page.text();new(require('node:vm').Script)(html.match(/<script nonce="[^"]+">([\s\S]*?)<\/script>/)[1]);assert.match(html,/customerTree/);
   assert.equal((await fetch(base+'/admin.js')).status,200);new(require('node:vm').Script)(fs.readFileSync(path.join(__dirname,'../public/admin.js'),'utf8'));
   assert.equal((await fetch(base+'/camera-scanner.js')).status,200);
   assert.equal((await fetch(base+'/photo-decoder.js')).status,200);
   const qrAsset=await fetch(base+'/vendor/jsqr.js');assert.equal(qrAsset.status,200);await qrAsset.arrayBuffer();
   const nativeTest=await fetch(base+'/camera-test');assert.equal(nativeTest.status,200);const nativeHtml=await nativeTest.text();assert.ok(!nativeHtml.includes('<script'));assert.match(nativeHtml,/type="file"/);
   const decoder=await fetch(base+'/vendor/zxing.js');assert.equal(decoder.status,200);assert.match(decoder.headers.get('content-type'),/javascript/);await decoder.arrayBuffer();
 });
 await t.test('Zákazníci: validace, unikátní kód a kontrola oprávnění',async()=>{
   assert.equal((await api('/admin/customers',undefined,false)).status,401);
   customerA=(await api('/admin/customers',{name:'Firma A',code:'A',email:'quality@example.cz'})).data;
   customerB=(await api('/admin/customers',{name:'Firma B',code:'B'})).data;
   assert.equal((await api('/admin/customers',{name:'Duplicitní',code:'A'})).status,409);
   assert.equal((await api('/admin/customers',{name:'Email',code:'C',email:'bad'})).status,400);
   assert.equal((await api(`/admin/customers/${customerA.id}`,{name:'Firma A',code:'A',contact:'Kontrola kvality',email:'quality@example.cz'})).status,200);
   assert.equal((await api(`/admin/customers/${customerA.id}`,{name:'Firma A',code:'B'})).status,409);
   assert.equal((await api('/admin/projects',{name:'Neexistující zákazník',customer_id:999,steps:[visual]})).status,404);
 });
 await t.test('Projekt: čtyři typy ověření a vazba na zákazníka',async()=>{
   const measurement={title:'Odchylka',instruction:'Změřit odchylku.',verification_type:'measurement',rule:'presence',min_value:-2,max_value:2,unit:'mm',rework_instruction:'Seřídit.'};
   const created=await api('/admin/projects',{name:'Projekt měření',customer_id:customerA.id,code:'P-001',description:'Kontrola držáku',steps:[visual,measurement,{...visual,verification_type:'qr',rule:'exact',expected:'COMP-QR'},{...visual,verification_type:'bar',rule:'presence'}]});assert.equal(created.status,201);project=created.data;
   const detail=(await api(`/admin/projects/${project.id}`)).data;assert.deepEqual(detail.steps.map(s=>s.verification_type),['visual','measurement','qr','bar']);assert.equal(detail.customer_id,customerA.id);
   assert.equal((await api('/admin/projects',{name:'Špatná tolerance',steps:[{...measurement,min_value:3,max_value:2}]})).status,400);
   assert.equal((await api('/admin/projects',{name:'Chybí mez',steps:[{...measurement,min_value:null}]})).status,400);
   await api(`/admin/projects/${project.id}/publish`,{});
 });
 await t.test('Částečná kontrola a záporné měření: tolerance, nula a neplatný vstup',async()=>{
   partial=await start('PART-PARTIAL');partial=(await act(partial,'scan',{scanned_value:'0'})).data.run;assert.equal(partial.state,'INSPECT');assert.equal(partial.position,2);
   assert.equal((await act(partial,'scan',{scanned_value:'0'})).status,409);
   assert.equal((await act(partial,'measure',{measured_value:''})).status,400);
   assert.equal((await act(partial,'measure',{measured_value:null})).status,400);
   const measured=await act(partial,'measure',{measured_value:-2});assert.equal(measured.data.result,'OK');assert.equal(measured.data.run.position,3);partial=measured.data.run;
   const zero=await start('PART-ZERO');const atMeasurement=(await act(zero,'scan',{scanned_value:'0'})).data.run;assert.equal((await act(atMeasurement,'measure',{measured_value:0})).data.result,'OK');
   let bad=await start('PART-NOK');bad=(await act(bad,'scan',{scanned_value:'0'})).data.run;bad=(await act(bad,'measure',{measured_value:-2.1})).data.run;assert.equal(bad.state,'VERIFY');bad=(await act(bad,'measure',{measured_value:2.1})).data.run;assert.equal(bad.state,'NOK');
   const other=(await api('/admin/projects',{name:'Jiný projekt',customer_id:customerB.id,steps:[visual]})).data;await api(`/admin/projects/${other.id}/publish`,{});await start('OTHER-CUSTOMER-SECRET',other);
   await start('NO-ATTEMPT');await start('=FORMULA-TEST');
 });
 await t.test('CSV: projektová izolace, hodnoty, rozpracovanost a formula injection',async()=>{
   const response=await raw(`/admin/projects/${project.id}/export?format=csv`);assert.equal(response.status,200);const csv=await response.text();
   assert.match(csv,/Číslo palety/);assert.match(csv,/PAL-001/);assert.match(csv,/BOX-001/);assert.match(csv,/"-2"/);assert.match(csv,/"0"/);assert.match(csv,/BEZ POKUSU/);assert.match(csv,/INSPECT/);assert.match(csv,/'=FORMULA-TEST/);assert.ok(!csv.includes('OTHER-CUSTOMER-SECRET'));
   assert.equal((await raw(`/admin/projects/${project.id}/export?format=csv`,undefined,false)).status,401);
   assert.equal((await raw(`/admin/projects/${project.id}/export?format=pdf`)).status,400);
 });
 await t.test('Excel: dva listy, graf, číselné hodnoty a součet unikátních dílů',async()=>{
   const response=await raw(`/admin/projects/${project.id}/export?format=xlsx`);assert.equal(response.status,200);
   const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));assert.deepEqual(workbook.worksheets.map(s=>s.name),['Data','Graf']);
   const data=workbook.getWorksheet('Data'),graph=workbook.getWorksheet('Graf');let foundNegative=false;data.eachRow((row,index)=>{if(index>1&&row.getCell(9).value===-2)foundNegative=true;});assert.equal(foundNegative,true);assert.equal(graph.getImages().length,1);assert.equal(graph.getCell('B18').value,5);assert.equal(graph.getCell('B8').value,1);assert.equal(graph.getCell('B14').value,4);
   // Prázdný projekt je platný export s nulovými součty.
   const empty=await api('/admin/projects',{name:'Prázdný',customer_id:customerA.id,steps:[visual]});const emptyFile=await raw(`/admin/projects/${empty.data.id}/export?format=xlsx`);const blank=new ExcelJS.Workbook();await blank.xlsx.load(Buffer.from(await emptyFile.arrayBuffer()));assert.equal(blank.getWorksheet('Graf').getCell('B18').value,0);
 });
 await t.test('PDF výkres: signatura a bezpečný typ odpovědi',async()=>{
   const pdf=Buffer.from('%PDF-1.4\nTest drawing\n%%EOF').toString('base64');const uploaded=await api('/admin/images',{data:'data:application/pdf;base64,'+pdf});assert.equal(uploaded.status,201);const response=await fetch(base+`/api/workflow/images/${uploaded.data.id}`);assert.equal(response.headers.get('content-type'),'application/pdf');
   assert.equal((await api('/admin/images',{data:'data:application/pdf;base64,'+Buffer.from('not a pdf').toString('base64')})).status,400);
 });
 await t.test('DOM administrace: přihlášení, zákazník, editor, uložení, výběr a kopie',async()=>{
   const {JSDOM}=require('jsdom');const html=fs.readFileSync(path.join(__dirname,'../public/index.html'),'utf8');
   const dom=new JSDOM(html,{url:base,runScripts:'outside-only'});const w=dom.window;
   w.fetch=(url,options)=>fetch(new URL(url,base),options);w.AbortController=global.AbortController;
   w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
   const script=fs.readFileSync(path.join(__dirname,'../public/scanner-protocol.js'),'utf8')+'\n'+html.match(/<script nonce="__NONCE__">([\s\S]*?)<\/script>/)[1]+'\n'+['admin.js','box-ui.js','scanner-console.js','camera-scanner.js'].map(name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8')).join('\n')+'\nwindow.testIdle=()=>!busy;';
   w.eval(script);const $=id=>w.document.getElementById(id);
   async function idle(){for(let i=0;i<400;i++){if(w.testIdle())return;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('UI request timeout: '+$('notice').textContent);}
   const submit=id=>$(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
   try {
     await idle();const before=db.prepare('SELECT COUNT(*) AS n FROM wf_events').get().n;$('scannerTest').value='1';$('scannerTest').dataset.scanRaw='1\r';submit('scannerTestForm');await idle();assert.match($('scannerTestResult').textContent,/ZNÁMÝ POVEL: NOK/);assert.match($('scannerTestResult').textContent,/310d/);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wf_events').get().n,before);$('adminTab').click();assert.equal(w.document.body.classList.contains('admin-mode'),true);
     $('adminKey').value=process.env.ADMIN_KEY;submit('loginForm');await idle();assert.equal($('adminContent').hidden,false);assert.match($('customerTree').textContent,/Firma A/);
     const companyFolder=$('customerTree').querySelector('details');assert.equal(companyFolder.open,false);companyFolder.querySelector('summary').click();assert.equal(companyFolder.open,true);companyFolder.querySelector('summary').click();assert.equal(companyFolder.open,false);
     $('newCustomer').click();assert.equal($('customerEditor').hidden,false);assert.equal($('customerEditor').querySelector('h1').textContent,'Vytvořit zákazníka');
     $('customerName').value='UI zákazník';$('customerCode').value='UI';submit('customerForm');await idle();assert.equal($('projectEditor').hidden,false);assert.equal($('projectCustomer').textContent,'UI zákazník');
     $('projectName').value='UI projekt';$('projectCode').value='UI-REV-1';
     const card=$('editors').firstElementChild;const field=key=>card.querySelector(`[data-key="${key}"]`);
     field('title').value='UI vada';field('instruction').value='UI pokyn';field('verification_type').value='measurement';field('verification_type').dispatchEvent(new w.Event('change'));assert.equal(card.querySelector('[data-zone="measurement"]').hidden,false);assert.equal(card.querySelector('[data-zone="scan"]').hidden,true);field('min_value').value='0';field('max_value').value='1';field('unit').value='mm';
     $('addStep').click();const second=$('editors').lastElementChild;second.querySelector('[data-key="title"]').value='Druhá vada';second.querySelector('[data-key="instruction"]').value='Druhý pokyn';second.querySelector('[data-move="up"]').click();assert.equal($('editors').firstElementChild,second);second.querySelector('[data-remove]').click();
     submit('projectForm');await idle();assert.equal($('projectDetail').hidden,false);assert.match($('detailName').textContent,/UI projekt/);assert.match($('detailSteps').textContent,/Naměřená hodnota/);assert.match($('customerTree').textContent,/UI projekt/);assert.equal($('exportCsv').textContent,'Mimořádný export CSV');
     $('copyProject').click();await idle();assert.equal($('projectEditor').hidden,false);assert.match($('projectName').value,/nová revize/);assert.equal($('editors').firstElementChild.querySelector('[data-key="min_value"]').value,'0');
     let projectFolder=[...$('customerTree').querySelectorAll('.project-folder')].find(el=>el.textContent.includes('UI projekt'));assert.ok(projectFolder);
     const findButton=(root,label)=>[...root.querySelectorAll('button')].find(el=>el.textContent===label);
     w.confirm=()=>false;findButton(projectFolder,'Smazat projekt').click();await idle();assert.ok($('customerTree').textContent.includes('UI projekt'));
     w.confirm=()=>true;findButton(projectFolder,'Smazat projekt').click();await idle();assert.ok(!$('customerTree').textContent.includes('UI projekt'));
     $('toggleTrash').click();await idle();assert.ok($('customerTree').textContent.includes('UI projekt'));assert.equal($('newCustomer').hidden,true);
     findButton($('customerTree'),'Obnovit projekt').click();await idle();assert.ok(!$('customerTree').textContent.includes('UI projekt'));
     $('toggleTrash').click();await idle();assert.ok($('customerTree').textContent.includes('UI projekt'));
     $('adminSearch').value='NO-MATCH';$('adminSearch').dispatchEvent(new w.Event('input'));assert.equal($('customerTree').children.length,0);
     $('logout').click();assert.equal($('adminContent').hidden,true);
     $('operatorTab').click();await idle();
     $('boxMode').value='manual';$('boxMode').dispatchEvent(new w.Event('change'));assert.ok([...w.document.querySelectorAll('[data-camera-for="box"]')].every(el=>el.hidden));
     $('boxMode').value='scan';$('boxMode').dispatchEvent(new w.Event('change'));assert.ok([...w.document.querySelectorAll('[data-camera-for="box"]')].every(el=>!el.hidden));
     assert.ok([...w.document.querySelectorAll('[data-camera-for="boxCount"]')].every(el=>el.hidden));$('boxCountMode').value='scan';$('boxCountMode').dispatchEvent(new w.Event('change'));assert.ok([...w.document.querySelectorAll('[data-camera-for="boxCount"]')].every(el=>!el.hidden));
     $('project').value=project.id;$('operator').value='UI-OP';$('box').value='UI-BOX';$('pallet').value='UI-PAL';$('boxCount').value='2';submit('stationForm');await idle();
     assert.match(w.document.querySelector('.box-counts').textContent,/Dokončeno 0 \/ 2/);
     let run=(await api('/runs/start',{project_id:project.id,operator_id:'UI-OP',box:'UI-BOX',pallet:'UI-PAL',qr_code:'UI-PART'},false)).data;
     for(const value of [{action:'scan',scanned_value:'0'},{action:'measure',measured_value:0},{action:'scan',scanned_value:'COMP-QR'},{action:'scan',scanned_value:'PRESENT'}])run=(await api(`/runs/${run.id}/actions`,{request_id:crypto.randomUUID(),version:run.version,...value},false)).data.run;
     w.BoxUI.update(run.box_progress);assert.equal(w.document.querySelector('.box-progress').value,1);assert.match($('stepDialog').querySelector('.box-counts').textContent,/Dokončeno 1 \/ 2/);
     const list=w.document.querySelector('.box-details');list.open=true;list.dispatchEvent(new w.Event('toggle'));await w.BoxUI.refresh();assert.match(w.document.querySelector('.box-items').textContent,/UI-PART/);assert.match(w.document.querySelector('.box-items').textContent,/OK/);
   } finally {w.close();}
 });
 await t.test('Koš: autorizace, kaskáda firmy, obnova, historie a rollback',async()=>{
   const company=(await api('/admin/customers',{name:'Firma do Koše',code:'TRASH'})).data;
   const create=async name=>(await api('/admin/projects',{name,customer_id:company.id,steps:[visual]})).data;
   const first=await create('Samostatně smazaný'),second=await create('Smazaný s firmou');
   await api(`/admin/projects/${second.id}/publish`,{});const active=await start('TRASH-PART',second);await act(active,'scan',{scanned_value:'0'});
   assert.equal((await api(`/admin/projects/${first.id}/delete`,{},false)).status,401);
   assert.equal((await api(`/admin/projects/${first.id}/delete`,{})).status,200);
   assert.equal((await api(`/admin/customers/${company.id}/delete`,{})).status,200);
   assert.ok(!(await api('/admin/customers')).data.some(c=>c.id===company.id));assert.ok(!(await api('/admin/projects')).data.some(p=>p.customer_id===company.id));
   assert.ok((await api('/admin/customers?include_deleted=1')).data.find(c=>c.id===company.id).deleted_at);
   assert.equal((await api(`/admin/projects/${second.id}/restore`,{})).status,409);
   assert.equal((await api('/admin/projects',{name:'Blokovaný',customer_id:company.id,steps:[visual]})).status,409);
   assert.equal((await api('/runs/start',{project_id:second.id,qr_code:'NEW-TRASH-PART',operator_id:'OP',box:'BOX-001',pallet:'PAL-001'},false)).status,409);
   assert.equal((await raw(`/admin/projects/${second.id}/export?format=csv`)).status,200);
   assert.equal(db.prepare('SELECT COUNT(*) AS n FROM wf_events WHERE run_id=?').get(active.id).n,1);
   assert.equal((await api(`/admin/customers/${company.id}/restore`,{})).status,200);
   const list=(await api('/admin/projects')).data;assert.ok(list.some(p=>p.id===second.id));assert.ok(!list.some(p=>p.id===first.id));
   assert.equal((await api(`/admin/projects/${first.id}/restore`,{})).status,200);
   db.exec(`CREATE TEMP TRIGGER trash_fail BEFORE UPDATE OF deleted_at ON wf_projects WHEN NEW.customer_id=${company.id} AND NEW.deleted_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'forced trash failure'); END`);
   assert.equal((await api(`/admin/customers/${company.id}/delete`,{})).status,500);
   assert.equal(db.prepare('SELECT deleted_at FROM wf_customers WHERE id=?').get(company.id).deleted_at,null);assert.equal(db.prepare('SELECT deleted_at FROM wf_projects WHERE id=?').get(second.id).deleted_at,null);db.exec('DROP TRIGGER trash_fail');
   assert.equal((await api('/admin/projects/999999/delete',{})).status,404);
 });
 } finally {await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(folder,{recursive:true,force:true});}
});
