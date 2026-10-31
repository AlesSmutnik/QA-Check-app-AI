'use strict';
(() => {
  const panel=document.createElement('section');panel.innerHTML='<details id="scannerTraining"><summary>Ověřit mobil / externí čtečku bez zápisu kontroly</summary><p>Naskenujte jeden řídicí QR. Výsledek se porovná s databázovým katalogem; nezmění žádný díl.</p><form id="scannerTestForm"><label for="scannerTest">Testovací sken</label><input id="scannerTest" maxlength="500" autocomplete="off" autocapitalize="off" spellcheck="false"><button type="submit">OVĚŘIT KÓD</button></form><pre id="scannerTestResult" role="status" aria-live="polite"></pre><p>OK = 0 · NOK = 1 · REWORK = R. Externí čtečka má odesílat Enter (CR nebo CRLF). Bez Enteru použijte OVĚŘIT KÓD.</p><p>Na fotografii zachyťte pouze jeden QR, nikoli celý list se třemi povely.</p><p id="catalogCount"></p></details>';
  document.getElementById('operatorView').append(panel);
  const get=id=>document.getElementById(id);
  get('scannerTestForm').onsubmit=event=>{event.preventDefault();const value=get('scannerTest').dataset.scanRaw??get('scannerTest').value;if(!get('scannerTest').value||busy)return;task(async()=>{
    const result=await api('/scan/inspect',{value});
    const names={ok:'OK',nok:'NOK',rework:'REWORK'};
    get('scannerTestResult').textContent=`${result.known?'ZNÁMÝ POVEL: '+names[result.action]:'DATOVÝ KÓD: není řídicí povel'}\nPřijato: ${JSON.stringify(result.raw)}\nHEX: ${result.hex}\nPo odstranění koncového CR/LF: ${JSON.stringify(result.canonical)}\nŽádná kontrola nebyla změněna.`;
    get('scannerTest').value='';delete get('scannerTest').dataset.scanRaw;setTimeout(()=>get('scannerTest').focus(),0);
  });};
  get('scannerTraining').addEventListener('toggle',async()=>{if(!get('scannerTraining').open)return;get('scannerTest').focus();try{const catalog=await api('/scan-catalog');get('catalogCount').textContent=`Katalog: ${catalog.images.length} referenčních obrázků, ${catalog.images.reduce((n,i)=>n+i.decoded.length,0)} ověřených QR, ${catalog.codes.length} přesných variant obsahu.`;}catch(error){get('catalogCount').textContent='Katalog se nepodařilo načíst: '+error.message;}});
})();
