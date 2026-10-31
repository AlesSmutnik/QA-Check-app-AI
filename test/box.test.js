'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const folder=fs.mkdtempSync(path.join(os.tmpdir(),'traceability-box-'));process.env.DATABASE_PATH=path.join(folder,'db.sqlite');process.env.NODE_ENV='production';process.env.ADMIN_KEY=crypto.randomBytes(32).toString('hex');
const app=require('../server'),db=require('../database');
test('Box: kapacita, jedinečné dokončené díly, NOK/REWORK, izolace a seznam',async()=>{
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 async function post(route,body,admin=false){const response=await fetch(base+'/api/workflow'+route,{method:'POST',headers:{'Content-Type':'application/json',...(admin?{Authorization:`Bearer ${process.env.ADMIN_KEY}`}:{})},body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
 try{
  const project=(await post('/admin/projects',{name:'Box test',steps:[{title:'Vada',instruction:'Ověřit',kind:'visual',rule:'part',rework_instruction:'Opravit'}]},true)).data;await post(`/admin/projects/${project.id}/publish`,{},true);
  const identity={project_id:project.id,pallet:'1',box:'1'},station={...identity,operator_id:'OP'};
  assert.equal((await post('/boxes/setup',{...identity,expected_count:0})).status,400);assert.equal((await post('/boxes/setup',{...identity,expected_count:1.5})).status,400);
  let progress=(await post('/boxes/setup',{...identity,expected_count:2})).data;assert.equal(progress.completed,0);assert.equal(progress.remaining,2);
  assert.equal((await post('/boxes/setup',{...identity,expected_count:3})).status,409);
  const start=qr=>post('/runs/start',{...station,qr_code:qr});const action=(run,action,scanned_value,request_id=crypto.randomUUID())=>post(`/runs/${run.id}/actions`,{request_id,version:run.version,action,scanned_value});
  let first=(await start('PART-1')).data;assert.equal(first.box_progress.total,1);assert.equal(first.box_progress.completed,0);
  first=(await action(first,'rework')).data.run;assert.equal(first.box_progress.rework,1);assert.equal(first.box_progress.completed,0);
  first=(await action(first,'scan','0')).data.run;assert.equal(first.box_progress.completed,0);assert.equal(first.state,'INSPECT');
  const requestId=crypto.randomUUID(),saved=await action(first,'scan','0',requestId);assert.equal(saved.data.run.box_progress.completed,1);assert.equal((await action(first,'scan','0',requestId)).data.run.box_progress.completed,1);
  assert.equal((await start('PART-1')).data.box_progress.completed,1);
  let second=(await start('PART-2')).data;assert.equal((await start('PART-3')).status,409);
  second=(await action(second,'scan','1')).data.run;assert.equal(second.box_progress.completed,1);second=(await action(second,'scan','1')).data.run;
  assert.equal(second.box_progress.completed,2);assert.equal(second.box_progress.ok,1);assert.equal(second.box_progress.nok,1);assert.equal(second.box_progress.remaining,0);assert.equal(second.box_progress.full,true);
  const list=(await post('/boxes/view',identity)).data;assert.equal(list.items.length,2);assert.deepEqual(list.items.map(i=>i.state),['NOK','OK']);
  const other={...identity,pallet:'2'};assert.equal((await post('/boxes/setup',{...other,expected_count:1})).data.completed,0);
  assert.equal((await post('/boxes/view',{...identity,page:-1})).status,400);
  assert.equal((await fetch(base+'/box-ui.js')).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(folder,{recursive:true,force:true});}
});
