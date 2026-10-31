'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),protocol=require('./public/scanner-protocol');
module.exports=function createCatalog(db){
 const directory=path.join(__dirname,'resources/scan-codes');const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
 db.transaction(()=>{
  db.exec(`CREATE TABLE IF NOT EXISTS wf_scan_codes (
   payload TEXT PRIMARY KEY, canonical TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('ok','nok','rework'))
  ) STRICT;
  CREATE TABLE IF NOT EXISTS wf_scan_reference_images (
   name TEXT PRIMARY KEY, sha256 TEXT NOT NULL, bytes BLOB NOT NULL, decoded TEXT NOT NULL
  ) STRICT;`);
  const insert=db.prepare('INSERT INTO wf_scan_codes(payload,canonical,action) VALUES (?,?,?) ON CONFLICT(payload) DO UPDATE SET canonical=excluded.canonical, action=excluded.action');
  const image=db.prepare('INSERT INTO wf_scan_reference_images(name,sha256,bytes,decoded) VALUES (?,?,?,?) ON CONFLICT(name) DO UPDATE SET sha256=excluded.sha256, bytes=excluded.bytes, decoded=excluded.decoded');
  for(const item of manifest.images){
   if(path.basename(item.name)!==item.name)throw new Error('Neplatná cesta QR reference.');
   const bytes=fs.readFileSync(path.join(directory,item.name));if(crypto.createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw new Error('Poškozená QR reference: '+item.name);
   for(const code of item.payloads){if(protocol.command(code.payload)!==code.action||protocol.normalize(code.payload)!==code.canonical)throw new Error('Neplatný katalog QR.');insert.run(code.payload,code.canonical,code.action);}
   image.run(item.name,item.sha256,bytes,JSON.stringify(item.payloads));
  }
 })();
 const lookup=db.prepare('SELECT canonical,action FROM wf_scan_codes WHERE payload=?');
 function resolve(value){if(typeof value!=='string')return null;return lookup.get(value)||lookup.get(protocol.normalize(value))||null;}
 return {resolve,command:value=>resolve(value)?.action||null,
  list:()=>({codes:db.prepare('SELECT payload,canonical,action FROM wf_scan_codes ORDER BY canonical,length(payload)').all(),images:db.prepare('SELECT name,sha256,decoded FROM wf_scan_reference_images ORDER BY name').all().map(i=>({...i,decoded:JSON.parse(i.decoded)}))})};
};
