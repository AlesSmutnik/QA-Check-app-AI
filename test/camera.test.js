'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../public/camera-scanner.js'),'utf8');
function setup(secure=false){
 const dom=new JSDOM('<form id="stationForm"><label>Operátor<input id="operator" maxlength="100"></label><label>Box<input id="box" maxlength="100"></label><label>Paleta<input id="pallet" maxlength="100"></label><label>Počet<input id="boxCount" type="number" min="1" max="10000"></label></form><form id="partForm"><label>Díl<input id="partQr" maxlength="200"></label></form><form id="stepForm"><input id="stepScan" maxlength="500"></form>',{url:'http://192.168.1.2:3000',runScripts:'outside-only'});
 const w=dom.window;const readers=[];let resets=0,photos=0,submits=0,releases=0;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};w.HTMLInputElement.prototype.click=function(){if(this.type==='file')photos++;this.dispatchEvent(new w.MouseEvent('click',{bubbles:true,cancelable:true}));};w.HTMLFormElement.prototype.requestSubmit=function(){submits++;};
 Object.defineProperty(w,'isSecureContext',{value:secure});Object.defineProperty(w.navigator,'mediaDevices',{value:{getUserMedia(){}}});
 w.URL.createObjectURL=()=> 'blob:test';w.URL.revokeObjectURL=()=>{releases++;};
 w.Image=class{naturalWidth=500;naturalHeight=500;set src(value){queueMicrotask(()=>this.onload());}};
 class Reader{constructor(){readers.push(this);}reset(){resets++;}async decodeFromConstraints(constraints,video,callback){this.callback=callback;this.constraints=constraints;if(Reader.failure)throw Reader.failure;}async decodeFromImageElement(){if(Reader.photoFailure)throw Reader.photoFailure;return {getText:()=>Reader.photoValue};}}
 Reader.photoValue='BOX-TEST';w.ZXing={BrowserMultiFormatReader:Reader,NotFoundException:class extends Error{}};
 w.eval(fs.readFileSync(path.join(__dirname,'../public/scanner-protocol.js'),'utf8')+'\n'+source);
 return {w,Reader,readers,dom,stats:()=>({resets,photos,submits,releases}),button:id=>w.document.querySelector(`[data-scan-target="${id}"]`),get:id=>w.document.getElementById(id)};
}
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
test('Fotoaparát načte počet kusů do číselného vstupu bez automatického potvrzení stanice',async()=>{
 const h=setup();try{const capture=h.w.document.querySelector('[data-photo-target="boxCount"]');capture.click();h.Reader.photoValue='20';Object.defineProperty(capture,'files',{value:[{type:'image/jpeg',size:100}]});capture.dispatchEvent(new h.w.Event('change'));await tick();assert.equal(h.get('boxCount').value,'20');assert.equal(h.stats().submits,0);}finally{h.dom.window.close();}
});
test('iPhone: přímý viditelný vstup otevře výběr bez dialogu a načte paletu po návratu',async()=>{
 const h=setup();try{
  const capture=h.w.document.querySelector('[data-photo-target="pallet"]');assert.equal(capture.type,'file');assert.equal(capture.hidden,false);assert.equal(capture.getAttribute('capture'),'environment');assert.equal(capture.closest('dialog'),null);assert.equal(capture.closest('label'),null);
  const click=new h.w.MouseEvent('click',{bubbles:true,cancelable:true});capture.dispatchEvent(click);assert.equal(click.defaultPrevented,false);
  for(const label of h.w.document.querySelectorAll('#stationForm label'))assert.equal(label.querySelectorAll('input,button').length,1);
  capture.click();assert.equal(h.get('cameraDialog').open,false);Object.defineProperty(h.w.document,'hidden',{value:true,configurable:true});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));h.w.dispatchEvent(new h.w.Event('pagehide'));
  h.Reader.photoValue='PAL-DIRECT';Object.defineProperty(capture,'files',{value:[{type:'image/jpeg',size:100}]});Object.defineProperty(h.w.document,'hidden',{value:false,configurable:true});capture.dispatchEvent(new h.w.Event('change'));await tick();assert.equal(h.get('pallet').value,'PAL-DIRECT');assert.equal(h.stats().submits,0);
 }finally{h.dom.window.close();}
});
test('Skutečný dekodér ZXing přečte QR včetně řídicích kódů a CR',()=>{
 const zxing=require('@zxing/library');
 for(const text of ['BOX-001','PAL-001','0\r','1','R']){
  const matrix=new zxing.QRCodeWriter().encode(text,zxing.BarcodeFormat.QR_CODE,240,240,new Map());
  const luminance=new Uint8ClampedArray(240*240);for(let y=0;y<240;y++)for(let x=0;x<240;x++)luminance[y*240+x]=matrix.get(x,y)?0:255;
  const bitmap=new zxing.BinaryBitmap(new zxing.HybridBinarizer(new zxing.RGBLuminanceSource(luminance,240,240)));
  const hints=new Map([[zxing.DecodeHintType.PURE_BARCODE,true],[zxing.DecodeHintType.POSSIBLE_FORMATS,[zxing.BarcodeFormat.QR_CODE]]]);
  assert.equal(new zxing.MultiFormatReader().decode(bitmap,hints).getText(),text);
 }
});
test('Detekce skutečných dodaných QR obrázků OK, NOK a REWORK',()=>{
 const z=require('@zxing/library'),{PNG}=require('pngjs');
 for(const [name,expected] of [['QR_OK_dil.png','0'],['QR_NOK_dil.png','1'],['QR_Rework.png','R']]){
  const p=PNG.sync.read(fs.readFileSync(path.join(__dirname,'fixtures',name))),pixels=new Int32Array(p.width*p.height);
  for(let i=0;i<pixels.length;i++)pixels[i]=(p.data[i*4]<<16)|(p.data[i*4+1]<<8)|p.data[i*4+2];
  const bitmap=new z.BinaryBitmap(new z.HybridBinarizer(new z.RGBLuminanceSource(pixels,p.width,p.height)));
  assert.equal(new z.MultiFormatReader().decode(bitmap,new Map()).getText(),expected);
 }
});
test('Fotoaparát: tlačítka a HTTP fotografie vyplní box bez odeslání formuláře',async()=>{
 const h=setup();try{for(const id of ['operator','box','pallet','partQr','stepScan'])assert.ok(h.button(id));h.button('box').click();assert.equal(h.stats().photos,0);assert.equal(h.get('cameraDialog').open,true);const file=h.get('cameraFile');assert.equal(file.hidden,false);assert.equal(file.closest('label').id,'cameraPhoto');file.click();assert.equal(h.stats().photos,1);Object.defineProperty(file,'files',{value:[{type:'image/png',size:100}]});file.dispatchEvent(new h.w.Event('change'));await tick();assert.equal(h.get('box').value,'BOX-TEST');assert.equal(h.stats().submits,0);assert.equal(h.stats().releases,1);assert.equal(h.get('cameraDialog').open,false);}finally{h.dom.window.close();}
});
test('Mobilní fotoaparát: skrytí stránky při focení nezruší cíl skenu',async()=>{
 const h=setup();try{
  h.button('pallet').click();h.get('cameraFile').click();Object.defineProperty(h.w.document,'hidden',{value:true,configurable:true});h.w.document.dispatchEvent(new h.w.Event('visibilitychange'));h.w.dispatchEvent(new h.w.Event('pagehide'));
  assert.equal(h.get('cameraDialog').open,true);
  h.Reader.photoValue='PAL-MOBILE';const file=h.get('cameraFile');Object.defineProperty(file,'files',{value:[{type:'image/jpeg',size:100}]});Object.defineProperty(h.w.document,'hidden',{value:false,configurable:true});file.dispatchEvent(new h.w.Event('change'));await tick();
  assert.equal(h.get('pallet').value,'PAL-MOBILE');assert.equal(h.get('cameraDialog').open,false);
 }finally{h.dom.window.close();}
});
test('Živý sken: zadní kamera, jediné odeslání, koncový CR a zastavení čtečky',async()=>{
 const h=setup(true);try{h.button('stepScan').click();await tick();const reader=h.readers[0];assert.equal(reader.constraints.video.facingMode.ideal,'environment');reader.callback({getText:()=> '0\r'});reader.callback({getText:()=> '0\r'});assert.equal(h.get('stepScan').value,'0');assert.equal(h.stats().submits,1);assert.ok(h.stats().resets>0);assert.equal(h.get('cameraDialog').open,false);}finally{h.dom.window.close();}
});
test('Zrušení nepřijme pozdní výsledek kamery a zastaví video stopy',async()=>{
 const h=setup(true);try{h.button('pallet').click();await tick();const reader=h.readers[0];let stopped=0;h.get('cameraVideo').srcObject={getTracks:()=>[{stop(){stopped++;}}]};h.get('cameraClose').click();reader.callback({getText:()=> 'LATE'});assert.equal(h.get('pallet').value,'');assert.equal(stopped,1);assert.equal(h.stats().submits,0);}finally{h.dom.window.close();}
});
test('Zamítnutá kamera a nečitelná fotografie nabízejí opakování bez změny dat',async()=>{
 const h=setup(true);try{h.Reader.failure=Object.assign(new Error('denied'),{name:'NotAllowedError'});h.button('partQr').click();await tick();assert.match(h.get('cameraMessage').textContent,/zamítnut/);h.Reader.photoFailure=new h.w.ZXing.NotFoundException();h.get('cameraFile').click();Object.defineProperty(h.get('cameraFile'),'files',{value:[{type:'image/jpeg',size:100}]});h.get('cameraFile').dispatchEvent(new h.w.Event('change'));await tick();assert.match(h.get('cameraMessage').textContent,/nebyl rozpoznán/);assert.equal(h.get('partQr').value,'');assert.equal(h.stats().submits,0);assert.equal(h.stats().releases,1);}finally{h.dom.window.close();}
});
test('HTTP fotografie: příliš dlouhý kód a nepovolený soubor nezmění pole',async()=>{
 const h=setup();try{h.button('box').click();h.Reader.photoValue='X'.repeat(101);const file=h.get('cameraFile');Object.defineProperty(file,'files',{value:[{type:'image/png',size:100}],configurable:true});file.dispatchEvent(new h.w.Event('change'));await tick();assert.match(h.get('cameraMessage').textContent,/příliš dlouhý/);assert.equal(h.get('box').value,'');Object.defineProperty(file,'files',{value:[{type:'application/pdf',size:100}]});file.dispatchEvent(new h.w.Event('change'));await tick();assert.match(h.get('cameraMessage').textContent,/obrázek do 12 MB/);}finally{h.dom.window.close();}
});
