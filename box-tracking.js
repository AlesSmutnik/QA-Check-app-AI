'use strict';
module.exports=function boxTracking(router,db,check,string,id,shape){
 db.exec(`CREATE TABLE IF NOT EXISTS wf_boxes (
  id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL REFERENCES wf_projects(id),
  pallet TEXT NOT NULL, box TEXT NOT NULL, expected_count INTEGER NOT NULL CHECK(expected_count BETWEEN 1 AND 10000),
  UNIQUE(project_id,pallet,box)
 ) STRICT;`);
 const config=db.prepare('SELECT * FROM wf_boxes WHERE project_id=? AND pallet=? AND box=?');
 const tally=db.prepare(`SELECT COUNT(*) AS total,
  COALESCE(SUM(state='OK'),0) AS ok,COALESCE(SUM(state='NOK'),0) AS nok,
  COALESCE(SUM(state='REWORK'),0) AS rework FROM wf_runs WHERE project_id=? AND pallet=? AND box=?`);
 db.exec('CREATE INDEX IF NOT EXISTS wf_runs_box ON wf_runs(project_id,pallet,box,id)');
 function summary(project,pallet,box){
  const found=config.get(project,pallet,box);if(!found)return null;
  const counts=tally.get(project,pallet,box),completed=counts.ok+counts.nok;
  return {...found,...counts,completed,pending:counts.total-completed,remaining:found.expected_count-completed,full:completed===found.expected_count};
 }
 function identity(body){return {project_id:id(body.project_id),pallet:string(body.pallet,'Paleta',100),box:string(body.box,'Box',100)};}
 const setup=db.transaction(data=>{
  const project=db.prepare('SELECT id FROM wf_projects WHERE id=? AND deleted_at IS NULL AND published=1').get(data.project_id);check(project,'Vyberte zveřejněný aktivní projekt.',409);
  const previous=config.get(data.project_id,data.pallet,data.box);
  if(previous)check(previous.expected_count===data.expected_count,`Box již má nastaveno ${previous.expected_count} kusů. Použijte tento počet nebo jiné označení boxu.`,409);
  const count=tally.get(data.project_id,data.pallet,data.box).total;check(data.expected_count>=count,'Počet kusů nemůže být nižší než počet již založených dílů v boxu.',409);
  db.prepare('INSERT INTO wf_boxes(project_id,pallet,box,expected_count) VALUES (?,?,?,?) ON CONFLICT(project_id,pallet,box) DO NOTHING').run(data.project_id,data.pallet,data.box,data.expected_count);
  return summary(data.project_id,data.pallet,data.box);
 });
 router.post('/boxes/setup',(req,res)=>{
  shape(req.body,['project_id','pallet','box','expected_count']);check(Number.isInteger(req.body.expected_count)&&req.body.expected_count>=1&&req.body.expected_count<=10000,'Počet kusů musí být celé číslo 1 až 10 000.');
  res.json(setup.immediate({...identity(req.body),expected_count:req.body.expected_count}));
 });
 const snapshot=db.transaction((data,page)=>{
  const progress=summary(data.project_id,data.pallet,data.box);check(progress,'Box není nastavený.',404);
  return {progress,page,page_size:50,items:db.prepare('SELECT id,qr_code,state,position,operator_id,updated_at FROM wf_runs WHERE project_id=? AND pallet=? AND box=? ORDER BY id DESC LIMIT ? OFFSET ?').all(data.project_id,data.pallet,data.box,50,(page-1)*50)};
 });
 router.post('/boxes/view',(req,res)=>{shape(req.body,['project_id','pallet','box','page']);const page=req.body.page===undefined?1:id(req.body.page);check(page<=1000000,'Neplatná stránka.');res.json(snapshot(identity(req.body),page));});
 return {summary,assertSpace(project,pallet,box){const found=summary(project,pallet,box);if(found)check(found.total<found.expected_count,'V boxu je již založen plánovaný počet dílů. Dokončete rozpracované díly nebo nastavte další box.',409);}};
};
