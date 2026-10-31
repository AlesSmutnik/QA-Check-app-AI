'use strict';
(() => {
  const dialog=document.createElement('dialog');dialog.id='cameraDialog';dialog.setAttribute('aria-labelledby','cameraTitle');
  dialog.innerHTML='<h2 id="cameraTitle">Skenování fotoaparátem</h2><p id="cameraMessage" role="status" aria-live="polite"></p><video id="cameraVideo" class="camera-preview" muted playsinline></video><div class="row"><button id="cameraLive" type="button">Živý sken</button><label id="cameraPhoto" class="camera-file-trigger">Vyfotit / vybrat fotografii<input id="cameraFile" type="file" accept="image/*" capture="environment" aria-label="Vyfotit nebo vybrat fotografii kódu"></label><button id="cameraClose" type="button">Zavřít</button></div>';
  document.body.append(dialog);
  const get=id=>document.getElementById(id),video=get('cameraVideo'),file=get('cameraFile');
  let target=null,reader=null,generation=0,accepted=false,awaitingPhoto=false;
  function message(value){get('cameraMessage').textContent=value;}
  function stop(){
    generation++;
    if(reader){reader.reset();reader=null;}
    if(video.srcObject){for(const track of video.srcObject.getTracks())track.stop();video.srcObject=null;}
    video.hidden=true;
  }
  function close(){awaitingPhoto=false;stop();target=null;file.value='';if(dialog.open)dialog.close();}
  function usable(input){return input && input.isConnected && !input.disabled && !input.closest('[hidden]');}
  function accept(value){
    if(accepted||!usable(target))return;
    const input=target,normalized=ScannerProtocol.normalize(value);
    if(typeof normalized!=='string'||!normalized.length||(input.maxLength>=0&&normalized.length>input.maxLength)||/[\u0000-\u001f\u007f]/u.test(normalized)){message('Kód má neplatný obsah nebo je příliš dlouhý. Zkuste jiný kód.');return;}
    if(['operator','partQr'].includes(input.id)&&ScannerProtocol.command(normalized)){message('Toto je řídicí QR OK/NOK/REWORK. Zde naskenujte identifikátor průkazu nebo dílu.');return;}
    if(input.id==='boxCount'&&(!/^[1-9]\d*$/.test(normalized)||Number(normalized)>10000)){message('Počet kusů musí být celé číslo 1 až 10 000.');return;}
    accepted=true;close();input.value=normalized;input.dataset.scanRaw=value;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.focus();
    // U boxu/palety pouze doplnění. Díl a kontrolní krok mají stejné odeslání jako Enter.
    if(['partQr','stepScan','scannerTest'].includes(input.id))input.form.requestSubmit();
  }
  function createReader(){if(!window.ZXing)throw new Error('Dekodér se nenačetl. Obnovte stránku.');return new ZXing.BrowserMultiFormatReader();}
  async function live(){
    stop();if(!window.isSecureContext||!navigator.mediaDevices?.getUserMedia){message('Živý sken vyžaduje HTTPS. Použijte tlačítko Vyfotit / vybrat fotografii.');return;}
    accepted=false;const session=generation;let ownReader;
    try {
      ownReader=createReader();reader=ownReader;video.hidden=false;message('Zamiřte zadní fotoaparát na jeden QR nebo čárový kód.');
      await ownReader.decodeFromConstraints({video:{facingMode:{ideal:'environment'}},audio:false},video,result=>{if(session!==generation||accepted||!dialog.open)return;if(result)accept(result.getText());});
      if(session!==generation)ownReader.reset();
    } catch(error){
      if(session!==generation){if(ownReader)ownReader.reset();return;}
      stop();message(error.name==='NotAllowedError'?'Přístup k fotoaparátu byl zamítnut. Povolte jej v prohlížeči nebo načtěte fotografii.':error.name==='NotFoundError'?'Fotoaparát nebyl nalezen. Vyberte fotografii kódu.':'Fotoaparát nelze otevřít. Zkuste načíst fotografii kódu.');
    }
  }
  function photo(){stop();accepted=false;awaitingPhoto=true;file.value='';message('Vyfoťte jeden kód zblízka, ostře a bez odlesků. Fotografie se zpracuje pouze v tomto zařízení.');}
  // Přímé klepnutí na nativní file input zachová uživatelskou aktivaci v Safari.
  // Žádné programové click() ani skrytý input.
  file.addEventListener('click',photo);
  file.addEventListener('cancel',()=>{awaitingPhoto=false;message('Fotografie nebyla vybrána. Můžete ji pořídit znovu.');});
  async function decodePhoto(selected){
    awaitingPhoto=false;
    if(!selected)return;
    stop();const session=generation;let url;
    try {
      if(!selected.type.startsWith('image/')||selected.size>12*1024*1024)throw new Error('Vyberte obrázek do 12 MB.');
      url=URL.createObjectURL(selected);const image=new Image();
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Fotografii nelze otevřít. Zvolte JPEG nebo PNG.'));image.src=url;});
      if(session!==generation||!dialog.open)return;
      if(image.naturalWidth*image.naturalHeight>32000000)throw new Error('Fotografie je příliš velká. Zvolte menší rozlišení.');
      message('Rozpoznávám QR v celé fotografii a ve výřezech…');
      let value=window.PhotoDecoder ? await PhotoDecoder.decodeQrImage(image,{isActive:()=>session===generation&&dialog.open}) : null;
      if(session!==generation||!dialog.open)return;
      if(value===null){reader=createReader();message('Ověřuji další typy kódů…');value=(await reader.decodeFromImageElement(image)).getText();}
      if(session===generation&&dialog.open)accept(value);
    } catch(error){if(session===generation)message(error.message && !(window.ZXing?.NotFoundException && error instanceof window.ZXing.NotFoundException)?error.message:'Kód nebyl rozpoznán. Vyfoťte jej znovu zblízka a ostře.');}
    finally {if(url)URL.revokeObjectURL(url);if(session===generation)stop();}
  }
  file.addEventListener('change',()=>decodePhoto(file.files?.[0]));
  get('cameraLive').onclick=live;get('cameraClose').onclick=close;
  dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{if(!dialog.open){awaitingPhoto=false;stop();target=null;}});
  // Nativní fotoaparát/výběr souboru na mobilu skryje stránku.
  // Cílové pole musí zůstat zachované až do návratu s fotografií.
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open&&!awaitingPhoto)close();});window.addEventListener('pagehide',()=>{if(!awaitingPhoto)close();});
  for(const id of ['operator','box','pallet','boxCount','partQr','stepScan','scannerTest']){
    const input=get(id);if(!input)continue;const button=document.createElement('button');button.type='button';button.className='camera-scan-button';button.dataset.scanTarget=id;button.textContent='Fotoaparát · skenovat kód';button.setAttribute('aria-label',`Skenovat fotoaparátem: ${id==='box'?'box':id==='pallet'?'paleta':id==='operator'?'průkaz operátora':id==='partQr'?'díl':'kontrolní krok'}`);
    input.addEventListener('keydown',event=>{if(event.key!=='Enter')delete input.dataset.scanRaw;});input.addEventListener('input',event=>{if(event.isTrusted)delete input.dataset.scanRaw;});
    button.onclick=event=>{event.preventDefault();if(!usable(input))return;stop();target=input;accepted=false;get('cameraTitle').textContent=button.getAttribute('aria-label');dialog.showModal();const canLive=Boolean(window.isSecureContext&&navigator.mediaDevices?.getUserMedia);get('cameraLive').hidden=!canLive;if(canLive)live();else message('Klepněte na Vyfotit / vybrat fotografii. Na této HTTP adrese se kód načte z potvrzené fotografie.');};input.after(button);
    // Samostatný, viditelný nativní vstup: bez dialogu, překryvu a .click().
    const capture=document.createElement('input');capture.type='file';capture.accept='image/*';capture.setAttribute('capture','environment');capture.dataset.photoTarget=id;capture.className='native-camera-input';capture.setAttribute('aria-label',`Vyfotit kód pro ${id}`);
    const caption=document.createElement('span');caption.className='native-camera-caption';caption.textContent='Vyfotit kód (iPhone): klepněte na Vybrat soubor';
    // Label smí označovat jediné pole. Nativní file input i tlačítko patří
    // mimo label původního textového pole, jinak mohou mobilní prohlížeče
    // přesměrovat klepnutí zpět do původního pole.
    const container=document.createElement('div');container.className='scan-field';
    const fieldLabel=input.closest('label');
    if(fieldLabel){fieldLabel.before(container);container.append(fieldLabel);}else input.after(container);
    container.append(caption,capture,button);
    for(const control of [caption,capture,button])control.dataset.cameraFor=id;
    capture.addEventListener('click',()=>{stop();target=input;accepted=false;awaitingPhoto=true;});
    capture.addEventListener('cancel',()=>{awaitingPhoto=false;target=null;});
    capture.addEventListener('change',()=>{const selected=capture.files?.[0];if(!selected){awaitingPhoto=false;return;}if(!usable(input)){close();return;}target=input;get('cameraTitle').textContent='Rozpoznání vyfotografovaného kódu';if(!dialog.open)dialog.showModal();decodePhoto(selected).finally(()=>{capture.value='';});});
  }
  window.syncScanModes?.();
})();
