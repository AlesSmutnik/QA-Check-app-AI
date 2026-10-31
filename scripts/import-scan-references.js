'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {PNG}=require('pngjs'),jsQR=require('jsqr'),protocol=require('../public/scanner-protocol');
const source=process.argv[2];if(!source)throw new Error('Zadejte složku s dodanými QR PNG.');
const directory=path.join(__dirname,'../resources/scan-codes');fs.mkdirSync(directory,{recursive:true});
const names=['QR_excel_3_kody.png','QR_Rework.png','QR_NOK_dil.png','QR_OK_dil.png','QR_REWORK_ENTER.png','QR_NOK_ENTER.png','QR_OK_ENTER.png'];
const images=[];
for(const name of names){
 const bytes=fs.readFileSync(path.join(source,name)),png=PNG.sync.read(bytes),count=name==='QR_excel_3_kody.png'?3:1,payloads=[];
 for(let region=0;region<count;region++){
  const left=Math.floor(region*png.width/count),width=Math.floor((region+1)*png.width/count)-left,data=new Uint8ClampedArray(width*png.height*4);
  for(let y=0;y<png.height;y++)for(let x=0;x<width;x++){const from=(y*png.width+x+left)*4,to=(y*width+x)*4;const alpha=png.data[from+3]/255;for(let c=0;c<3;c++)data[to+c]=png.data[from+c]*alpha+255*(1-alpha);data[to+3]=255;}
  const decoded=jsQR(data,width,png.height);if(!decoded||!protocol.command(decoded.data))throw new Error('Neznámý nebo nečitelný řídicí kód: '+name);
  payloads.push({region:region+1,payload:decoded.data,hex:Buffer.from(decoded.data,'utf8').toString('hex'),canonical:protocol.normalize(decoded.data),action:protocol.command(decoded.data)});
 }
 fs.writeFileSync(path.join(directory,name),bytes);images.push({name,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),payloads});
}
fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify({version:1,images},null,2)+'\n');
console.log(`Ověřeno ${images.length} obrázků, ${images.reduce((n,i)=>n+i.payloads.length,0)} QR referencí.`);
