'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{PNG}=require('pngjs');
const {decodeQrImage}=require('../public/photo-decoder');
function canvasFactory(){
 const canvas={width:0,height:0};let image,region;
 canvas.getContext=()=>({fillRect(){},drawImage(source,x,y,w,h){image=source;region={x,y,w,h};},getImageData(){
  const data=new Uint8ClampedArray(canvas.width*canvas.height*4);
  for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++){
   const sx=Math.min(image.naturalWidth-1,Math.floor(region.x+x*region.w/canvas.width)),sy=Math.min(image.naturalHeight-1,Math.floor(region.y+y*region.h/canvas.height));
   const source=(sy*image.naturalWidth+sx)*4,target=(y*canvas.width+x)*4;for(let c=0;c<4;c++)data[target+c]=image.data[source+c];
  }return {data};
 }});return canvas;
}
test('Fotografie: dodaný NOK QR skutečně vrací 1',async()=>{
 const p=PNG.sync.read(fs.readFileSync(path.join(__dirname,'fixtures/QR_NOK_dil.png')));
 assert.equal(await decodeQrImage({naturalWidth:p.width,naturalHeight:p.height,data:p.data},{decode:require('jsqr'),createCanvas:canvasFactory}),'1');
});
test('Fotografie: QR v pozadí většího snímku, otočený a s nižším kontrastem',async()=>{
 const p=PNG.sync.read(fs.readFileSync(path.join(__dirname,'fixtures/QR_NOK_dil.png'))),width=1000,height=800,data=new Uint8ClampedArray(width*height*4);data.fill(210);
 for(let i=3;i<data.length;i+=4)data[i]=255;
 const size=280;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const sx=Math.floor(y*p.width/size),sy=p.height-1-Math.floor(x*p.height/size),v=p.data[(sy*p.width+sx)*4]<128?65:210,target=((y+240)*width+x+360)*4;for(let c=0;c<3;c++)data[target+c]=v;
 }
 assert.equal(await decodeQrImage({naturalWidth:width,naturalHeight:height,data},{decode:require('jsqr'),createCanvas:canvasFactory}),'1');
});
test('Fotografie: opakuje čtení ve výřezech, umí zrušení a nevrací falešný kód',async()=>{
 const image={naturalWidth:400,naturalHeight:400,data:new Uint8ClampedArray(400*400*4)};let attempts=0;
 assert.equal(await decodeQrImage(image,{createCanvas:canvasFactory,decode:()=>++attempts===3?{data:'0'}:null}),'0');assert.ok(attempts>=3);
 attempts=0;assert.equal(await decodeQrImage(image,{createCanvas:canvasFactory,decode:()=>{attempts++;return null;},isActive:()=>attempts<1}),null);assert.equal(attempts,1);
 assert.equal(await decodeQrImage(image,{createCanvas:canvasFactory,decode:()=>null}),null);
});
test('Fotografie celého listu: různé povely se nesmí náhodně vybrat',async()=>{
 const p=PNG.sync.read(fs.readFileSync(path.join(__dirname,'../resources/scan-codes/QR_excel_3_kody.png')));
 await assert.rejects(()=>decodeQrImage({naturalWidth:p.width,naturalHeight:p.height,data:p.data},{decode:require('jsqr'),createCanvas:canvasFactory}),/různé QR/);
});
