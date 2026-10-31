'use strict';
const ExcelJS = require('exceljs');
const { PNG } = require('pngjs');

const columns = [
  ['customer','Zákazník'],['project','Projekt'],['pallet','Číslo palety'],['box','Číslo boxu'],['part','Číslo dílu'],
  ['ok','OK'],['nok','NOK'],['rework','Rework'],['value','Naměřená hodnota'],['unit','Jednotka'],
  ['position','Krok'],['defect','Název vady'],['result','Výsledek pokusu'],['final_state','Stav dílu'],['timestamp','Čas UTC']
];
function csvCell(value) {
  let text = value == null ? '' : String(value);
  if(typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g,'""') + '"';
}
function chartPng(counts) {
  const image = new PNG({width:600,height:240}); image.data.fill(255);
  const max = Math.max(1,...counts);
  const colors = [[26,135,90],[190,42,66],[216,157,24],[91,112,139]];
  counts.forEach((count,index) => {
    const width = Math.round(count/max*570);
    for(let y=index*60+8;y<index*60+48;y++) for(let x=10;x<10+width;x++) {
      const pixel=(y*600+x)*4;image.data[pixel]=colors[index][0];image.data[pixel+1]=colors[index][1];image.data[pixel+2]=colors[index][2];
    }
  });
  return PNG.sync.write(image);
}
module.exports = function projectExport(router, db, check, id) {
  const snapshot = db.transaction(projectId => {
    const project=db.prepare(`SELECT p.*, c.name AS customer_name FROM wf_projects p LEFT JOIN wf_customers c ON c.id=p.customer_id WHERE p.id=?`).get(projectId);
    check(project,'Projekt neexistuje.',404);
    const count=db.prepare(`SELECT COUNT(*) AS n FROM wf_runs r LEFT JOIN wf_events e ON e.run_id=r.id WHERE r.project_id=?`).get(projectId).n;
    check(count<=100000,'Export přesahuje 100 000 řádků. Pro tento objem je nutný dávkový export.',413);
    const rows=db.prepare(`SELECT COALESCE(c.name,'Nepřiřazený zákazník') AS customer, p.name AS project,
      r.pallet, r.box, r.qr_code AS part,
      CASE e.result WHEN 'OK' THEN 1 ELSE 0 END AS ok,
      CASE e.result WHEN 'NOK' THEN 1 ELSE 0 END AS nok,
      CASE e.result WHEN 'REWORK' THEN 1 ELSE 0 END AS rework,
      e.measured_value AS value, s.unit, e.position, s.title AS defect,
      COALESCE(e.result,'BEZ POKUSU') AS result, r.state AS final_state,
      COALESCE(e.created_at,r.created_at) AS timestamp
      FROM wf_runs r JOIN wf_projects p ON p.id=r.project_id
      LEFT JOIN wf_customers c ON c.id=p.customer_id
      LEFT JOIN wf_events e ON e.run_id=r.id
      LEFT JOIN wf_steps s ON s.project_id=r.project_id AND s.position=e.position
      WHERE r.project_id=? ORDER BY r.id,e.id`).all(projectId);
    const counts={OK:0,NOK:0,REWORK:0,PENDING:0};
    for(const row of db.prepare('SELECT state,COUNT(*) AS n FROM wf_runs WHERE project_id=? GROUP BY state').all(projectId)) counts[['OK','NOK','REWORK'].includes(row.state)?row.state:'PENDING']+=row.n;
    return {project,rows,counts};
  });
  router.get('/admin/projects/:id/export',async(req,res)=>{
    const format=req.query.format ?? 'csv';check(['csv','xlsx'].includes(format),'Podporován je CSV nebo XLSX.');
    const projectId=id(req.params.id), data=snapshot(projectId);
    if(format==='csv') {
      res.setHeader('Content-Disposition',`attachment; filename="project-${projectId}.csv"`);
      return res.type('text/csv; charset=utf-8').send('\uFEFF'+columns.map(item=>csvCell(item[1])).join(';')+'\r\n'+data.rows.map(row=>columns.map(([key])=>csvCell(row[key])).join(';')).join('\r\n')+'\r\n');
    }
    const workbook=new ExcelJS.Workbook();workbook.creator='Traceability Firewall';
    const sheet=workbook.addWorksheet('Data',{views:[{state:'frozen',ySplit:1}]});
    sheet.columns=columns.map(([key,header])=>({key,header,width:['customer','project','defect'].includes(key)?30:key==='timestamp'?26:20}));
    data.rows.forEach(row=>sheet.addRow(row));sheet.autoFilter={from:'A1',to:'O1'};sheet.getRow(1).height=32;
    sheet.getRow(1).eachCell(cell=>{cell.font={bold:true,color:{argb:'FFFFFFFF'}};cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF18334F'}};cell.alignment={wrapText:true,vertical:'middle'};});
    sheet.getColumn('value').numFmt='0.########';
    const graph=workbook.addWorksheet('Graf');graph.getColumn(1).width=26;graph.getColumn(2).width=18;
    for(let i=3;i<=11;i++)graph.getColumn(i).width=12;
    graph.mergeCells('A1:K1');graph.getCell('A1').value=`Výsledky dílů: ${data.project.name}`;graph.getCell('A1').font={size:18,bold:true};graph.getRow(1).height=32;
    graph.mergeCells('A2:K2');graph.getCell('A2').value='Každý díl je započten jednou podle aktuálního stavu. Data obsahují všechny pokusy.';graph.getCell('A2').alignment={wrapText:true};graph.getRow(2).height=36;
    const entries=[['OK',data.counts.OK],['NOK',data.counts.NOK],['REWORK',data.counts.REWORK],['Rozpracováno',data.counts.PENDING]];
    entries.forEach(([label,count],index)=>{const row=5+index*3;graph.getCell(`A${row}`).value=label;graph.getCell(`B${row}`).value=count;graph.getCell(`A${row}`).font={bold:true};for(let j=0;j<3;j++)graph.getRow(row+j).height=15;});
    const imageId=workbook.addImage({buffer:chartPng(entries.map(item=>item[1])),extension:'png'});
    graph.addImage(imageId,{tl:{col:2,row:4},ext:{width:600,height:240}});
    graph.getCell('A18').value='Celkem dílů';graph.getCell('B18').value=entries.reduce((sum,item)=>sum+item[1],0);
    graph.mergeCells('A20:K20');graph.getCell('A20').value='Graf je snímek stavu při exportu. Po změnách stáhněte nový export.';
    res.setHeader('Content-Disposition',`attachment; filename="project-${projectId}.xlsx"`);
    res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(Buffer.from(await workbook.xlsx.writeBuffer()));
  });
};
