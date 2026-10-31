'use strict';
(() => {
  const get=id=>document.getElementById(id),cards=[];let currentBox=null,page=1,requestVersion=0,inflight=null;
  const labels={OK:'OK',NOK:'NOK',REWORK:'REWORK',INSPECT:'Rozpracováno',VERIFY:'Opakované ověření'};
  function card(){
    const element=document.createElement('section');element.className='box-tracker';element.hidden=true;
    element.innerHTML='<h2 class="box-heading">Průběh boxu</h2><progress class="box-progress" max="1" value="0" aria-label="Dokončené díly v boxu"></progress><p class="box-counts" role="status" aria-live="polite"></p><details class="box-details"><summary>Zobrazit seznam dílů a výsledků</summary><div class="box-items"></div><div class="row"><button type="button" class="box-prev">Předchozí</button><span class="box-page"></span><button type="button" class="box-next">Další</button><button type="button" class="box-refresh">Obnovit</button></div></details>';
    element.querySelector('.box-details').addEventListener('toggle',()=>{if(element.querySelector('details').open)load().catch(error=>notice(error.message,true));});
    element.querySelector('.box-refresh').onclick=()=>task(load);element.querySelector('.box-prev').onclick=()=>{if(page>1){page--;task(load);}};
    element.querySelector('.box-next').onclick=()=>{if(currentBox&&page*50<currentBox.total){page++;task(load);}};
    cards.push(element);return element;
  }
  get('scanPanel').before(card());get('stepDialog').prepend(card());
  function paint(progress){
    if(get('partForm'))get('partForm').hidden=Boolean(progress?.full);
    for(const element of cards){element.hidden=!progress;if(!progress)continue;element.querySelector('.box-heading').textContent=`Box ${progress.box} · paleta ${progress.pallet}`;
      const bar=element.querySelector('progress');bar.max=progress.expected_count;bar.value=progress.completed;
      element.querySelector('.box-counts').textContent=`Dokončeno ${progress.completed} / ${progress.expected_count} (${Math.round(progress.completed/progress.expected_count*100)} %) · OK ${progress.ok} · NOK ${progress.nok} · REWORK ${progress.rework} · Rozpracováno ${progress.pending} · Zbývá ${progress.remaining}${progress.full?' · BOX DOKONČEN':''}`;
    }
  }
  function identity(box){return JSON.stringify([box?.project_id,box?.pallet,box?.box]);}
  function load(){
    if(!currentBox)return Promise.resolve();const key=JSON.stringify([identity(currentBox),page]);
    if(inflight?.key===key)return inflight.promise;
    const promise=fetchSnapshot();inflight={key,promise};const clear=()=>{if(inflight?.promise===promise)inflight=null;};promise.then(clear,clear);return promise;
  }
  async function fetchSnapshot(){
    if(!currentBox)return;const version=++requestVersion,key=identity(currentBox);
    const data=await api('/boxes/view',{project_id:currentBox.project_id,pallet:currentBox.pallet,box:currentBox.box,page});
    if(version!==requestVersion||key!==identity(currentBox))return;
    currentBox=data.progress;paint(currentBox);
    for(const element of cards){const container=element.querySelector('.box-items');container.replaceChildren();const table=document.createElement('table');
      const head=document.createElement('tr');for(const label of ['Díl','Výsledek','Operátor']){const th=document.createElement('th');th.textContent=label;head.append(th);}table.append(head);
      for(const item of data.items){const row=document.createElement('tr');for(const value of [item.qr_code,labels[item.state]||item.state,item.operator_id]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}table.append(row);}
      container.append(table);if(!data.items.length){const empty=document.createElement('p');empty.textContent='V boxu zatím není zahájena žádná kontrola.';container.append(empty);}element.querySelector('.box-page').textContent=`Strana ${page} · ${data.progress.total} založených dílů`;
    }
  }
  window.BoxUI={update(progress){if(identity(progress)!==identity(currentBox))page=1;requestVersion++;inflight=null;currentBox=progress;paint(progress);if(progress&&cards.some(card=>card.querySelector('details').open))load().catch(error=>notice('Seznam dílů se nepodařilo obnovit: '+error.message,true));},refresh:load};
  window.syncScanModes=()=>{for(const id of ['box','pallet','boxCount']){const selector=get(id+'Mode');if(!selector)continue;const manual=selector.value==='manual';for(const control of document.querySelectorAll(`[data-camera-for="${id}"]`))control.hidden=manual;get(id).placeholder=id==='boxCount'?(manual?'Zadejte počet kusů':'Naskenujte počet kusů'):(manual?'Zadejte označení ručně':'Naskenujte označení');}};
  for(const id of ['boxMode','palletMode','boxCountMode'])get(id).addEventListener('change',window.syncScanModes);
  window.syncScanModes();
})();
