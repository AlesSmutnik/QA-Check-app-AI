'use strict';
(() => {
  let customers=[], projects=[], selectedCustomer=null, selectedProject=null, draftCustomer=null, editingCustomer=null, trashMode=false;
  const expanded=new Set();
  const typeLabels={visual:'Vizuální',qr:'QR',bar:'Čárový kód',measurement:'Naměřená hodnota'};
  function show(id){for(const panel of ['adminWelcome','customerEditor','projectEditor','projectDetail'])$(panel).hidden=panel!==id;}
  function button(label,fn,className=''){const el=document.createElement('button');el.type='button';el.textContent=label;el.className=className;el.onclick=()=>task(fn);return el;}
  function text(tag,value){const el=document.createElement(tag);el.textContent=value;return el;}
  async function refresh(){const query=trashMode?'?include_deleted=1':'';[customers,projects]=await Promise.all([api('/admin/customers'+query,undefined,true),api('/admin/projects'+query,undefined,true)]);tree();}
  async function remove(type,record){
    const label=type==='customers'?'firmu a její projekty':'projekt';
    if(!window.confirm(`Přesunout ${label} „${record.name}“ do Koše? Výsledky a historie zůstanou zachované.`))return;
    await api(`/admin/${type}/${record.id}/delete`,{},true);selectedProject=null;selectedCustomer=null;show('adminWelcome');await refresh();notice('Přesunuto do Koše. Záznam lze obnovit.');
  }
  async function restore(type,record){await api(`/admin/${type}/${record.id}/restore`,{},true);await refresh();show('adminWelcome');notice('Záznam obnoven.');}
  function tree(){
    const query=$('adminSearch').value.trim().toLocaleLowerCase('cs');$('customerTree').replaceChildren();
    const groups=[...customers];if(projects.some(p=>p.customer_id===null))groups.push({id:null,name:'Původní projekty bez zákazníka'});
    for(const customer of groups){const list=projects.filter(p=>p.customer_id===customer.id && (trashMode?Boolean(p.deleted_at):!p.deleted_at));const filtered=list.filter(p=>`${p.name} ${p.code}`.toLocaleLowerCase('cs').includes(query));
      if(trashMode&&!customer.deleted_at&&!list.length)continue;
      if(query&&!customer.name.toLocaleLowerCase('cs').includes(query)&&!filtered.length)continue;
      const key=customer.id??'legacy';const group=document.createElement('details');group.className='customer-group';group.dataset.customerId=String(key);group.open=Boolean(query)||expanded.has(key)||selectedCustomer===customer.id;
      const heading=text('summary',`${customer.name} (${list.length})${customer.deleted_at?' · v Koši':''}`);group.append(heading);
      group.addEventListener('toggle',()=>{if(!group.isConnected)return;if(group.open)expanded.add(key);else expanded.delete(key);});
      const content=document.createElement('div');content.className='customer-projects';group.append(content);
      if(customer.id&&!trashMode)content.append(button('Údaje zákazníka',async()=>{editingCustomer=customer.id;show('customerEditor');$('customerEditor').querySelector('h1').textContent='Upravit zákazníka';for(const [field,key] of [['customerName','name'],['customerCode','code'],['customerContact','contact'],['customerEmail','email'],['customerNotes','notes']])$(field).value=customer[key]||'';},'new-project'));
      if(customer.id&&!trashMode)content.append(button('+ Vytvořit projekt',async()=>newProject(customer.id),'new-project'));
      if(customer.id&&!trashMode)content.append(button('Smazat firmu',()=>remove('customers',customer),'new-project danger'));
      if(customer.deleted_at)content.append(button('Obnovit firmu a její projekty',()=>restore('customers',customer),'new-project primary'));
      for(const project of (customer.name.toLocaleLowerCase('cs').includes(query)?list:filtered)) {
        const folder=document.createElement('div');folder.className='project-folder';content.append(folder);
        folder.append(button(`${project.name}${project.code?' · '+project.code:''}\n${project.deleted_at?'V Koši':project.published?'Zveřejněný':'Návrh'} · ${project.run_count} dílů`,()=>detail(project.id),`project-choice${selectedProject===project.id?' selected':''}`));
        folder.append(button('Mimořádný export CSV',()=>download(project.id,'csv'),'new-project'));
        if(!trashMode)folder.append(button('Smazat projekt',()=>remove('projects',project),'new-project danger'));
        else if(!customer.deleted_at)folder.append(button('Obnovit projekt',()=>restore('projects',project),'new-project primary'));
      }
      if(!list.length)content.append(text('p','Zatím bez projektu.'));$('customerTree').append(group);
    }
    if(!$('customerTree').children.length&&!query)$('customerTree').append(text('p',trashMode?'Koš je prázdný.':'Začněte vytvořením zákazníka.'));
  }
  function newProject(customerId,seed){
    draftCustomer=customerId;selectedCustomer=customerId;expanded.add(customerId??'legacy');selectedProject=null;tree();show('projectEditor');
    $('projectCustomer').textContent=customers.find(c=>c.id===customerId)?.name||'Původní projekt';
    $('projectName').value=seed?seed.name+' · nová revize':'';$('projectCode').value=seed?.code||'';$('projectDescription').value=seed?.description||'';
    $('editors').replaceChildren();for(const step of seed?.steps||[{}])editor(step);$('projectName').focus();
  }
  function attachment(container,step){
    if(!step.image_id)return;
    const url=`/api/workflow/images/${step.image_id}`;
    const link=document.createElement('a');link.href=url;link.target='_blank';link.rel='noopener';link.className='attachment-link';link.textContent=step.image_mime==='application/pdf'?'Otevřít výkres PDF':'Otevřít fotografii';container.append(link);
    if(step.image_mime!=='application/pdf'){const image=document.createElement('img');image.src=url;image.alt=step.title||'Referenční fotografie';container.append(image);}
  }
  async function detail(projectId){
    const data=await api(`/admin/projects/${projectId}`,undefined,true);selectedProject=projectId;selectedCustomer=data.customer_id;tree();show('projectDetail');
    $('detailCustomer').textContent=customers.find(c=>c.id===data.customer_id)?.name||'Bez přiřazeného zákazníka';$('detailStatus').textContent=data.deleted_at?'V KOŠI':data.published?'ZVEŘEJNĚNO':'NÁVRH';
    $('detailName').textContent=data.name+ (data.code?' · '+data.code:'');$('detailDescription').textContent=data.description||'';$('publishProject').hidden=Boolean(data.published||data.deleted_at);$('copyProject').hidden=Boolean(data.deleted_at);
    $('publishProject').onclick=()=>task(async()=>{await api(`/admin/projects/${projectId}/publish`,{},true);await refresh();await detail(projectId);notice('Projekt zveřejněn operátorům.');});
    $('copyProject').onclick=()=>task(async()=>newProject(data.customer_id,data));
    $('exportCsv').onclick=()=>task(()=>download(projectId,'csv'));$('exportXlsx').onclick=()=>task(()=>download(projectId,'xlsx'));
    $('detailSteps').replaceChildren();for(const step of data.steps){const card=document.createElement('div');card.className='detail-step defect-preview';card.append(text('h2',`${step.position}. ${step.title}`),text('p',step.instruction),text('p',`Ověření: ${typeLabels[step.verification_type]||'QR'}${step.verification_type==='measurement'?` · ${step.min_value} až ${step.max_value} ${step.unit}`:step.rule==='exact'?` · přesná shoda: ${step.expected}`:step.rule==='presence'?' · přítomnost':' · QR dílu'}`));attachment(card,step);if(step.rework_instruction)card.append(text('p','REWORK: '+step.rework_instruction));$('detailSteps').append(card);}
  }
  function editor(seed={}){
    const card=document.createElement('div');card.className='card step-editor';
    card.innerHTML='<h3 class="step-heading"></h3><label>Název vady<input data-key="title" required maxlength="200"></label><label>Popis vady / postup ověření<textarea data-key="instruction" required maxlength="4000"></textarea></label><label>Typ ověření<select data-key="verification_type"><option value="visual">Vizuální</option><option value="qr">QR</option><option value="bar">Čárový kód</option><option value="measurement">Naměřená hodnota</option></select></label><div data-zone="scan"><label>Pravidlo ověření<select data-key="rule"><option value="part">QR stejného dílu</option><option value="exact">Přesná shoda</option><option value="presence">Přítomnost kódu</option></select></label><label data-zone="expected">Očekávaná hodnota kódu<input data-key="expected" maxlength="500"></label></div><div data-zone="measurement" class="fields measurement-fields"><label>Dolní mez<input data-key="min_value" type="number" step="any"></label><label>Horní mez<input data-key="max_value" type="number" step="any"></label><label>Jednotka<input data-key="unit" maxlength="30" placeholder="Např. mm"></label></div><label>Fotografie nebo výkres · PNG, JPEG, PDF do 4 MB<input data-key="file" type="file" accept="image/png,image/jpeg,application/pdf"></label><div class="defect-preview"></div><label>Pokyn pro REWORK · prázdné = nepovoleno<textarea data-key="rework_instruction" maxlength="4000"></textarea></label><div class="row"><button type="button" data-move="up">Posunout nahoru</button><button type="button" data-move="down">Posunout dolů</button><button type="button" data-remove="true">Odebrat krok</button></div>';
    const field=key=>card.querySelector(`[data-key="${key}"]`);card.imageId=seed.image_id??null;
    for(const key of ['title','instruction','expected','min_value','max_value','unit','rework_instruction'])if(seed[key]!=null)field(key).value=seed[key];
    field('verification_type').value=seed.verification_type||(seed.kind==='scan'?'qr':'visual');field('rule').value=seed.rule||'part';attachment(card.querySelector('.defect-preview'),seed);
    const sync=()=>{const type=field('verification_type').value,scan=type==='qr'||type==='bar',measure=type==='measurement';card.querySelector('[data-zone="scan"]').hidden=!scan;card.querySelector('[data-zone="expected"]').hidden=!scan||field('rule').value!=='exact';field('expected').required=scan&&field('rule').value==='exact';card.querySelector('[data-zone="measurement"]').hidden=!measure;field('min_value').required=measure;field('max_value').required=measure;};
    field('verification_type').onchange=sync;field('rule').onchange=sync;sync();
    field('file').onchange=()=>{card.imageId=null;card.querySelector('.defect-preview').replaceChildren(text('p','Příloha se nahraje při uložení projektu.'));};
    card.querySelector('[data-remove]').onclick=()=>{card.remove();renumber();};
    card.querySelector('[data-move="up"]').onclick=()=>{if(card.previousElementSibling)card.parentNode.insertBefore(card,card.previousElementSibling);renumber();};
    card.querySelector('[data-move="down"]').onclick=()=>{if(card.nextElementSibling)card.parentNode.insertBefore(card.nextElementSibling,card);renumber();};
    $('editors').append(card);renumber();
  }
  function renumber(){[...$('editors').children].forEach((card,index)=>{card.querySelector('.step-heading').textContent=`Krok ${index+1}`;});}
  function readFile(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Přílohu nelze načíst.'));reader.readAsDataURL(file);});}
  $('addStep').onclick=()=>editor();
  $('newCustomer').onclick=()=>{editingCustomer=null;show('customerEditor');$('customerEditor').querySelector('h1').textContent='Vytvořit zákazníka';$('customerForm').reset();$('customerName').focus();};
  $('adminSearch').oninput=tree;
  const trashButton=document.createElement('button');trashButton.id='toggleTrash';trashButton.textContent='Koš';trashButton.type='button';trashButton.onclick=()=>task(async()=>{trashMode=!trashMode;selectedProject=null;selectedCustomer=null;$('newCustomer').hidden=trashMode;trashButton.textContent=trashMode?'Zpět na aktivní firmy':'Koš';show('adminWelcome');await refresh();});$('logout').before(trashButton);
  $('customerForm').onsubmit=event=>{event.preventDefault();task(async()=>{const editing=editingCustomer!==null;const customer=await api(editing?`/admin/customers/${editingCustomer}`:'/admin/customers',{name:$('customerName').value.trim(),code:$('customerCode').value.trim(),contact:$('customerContact').value.trim(),email:$('customerEmail').value.trim(),notes:$('customerNotes').value.trim()},true);await refresh();if(editing){show('adminWelcome');notice('Údaje zákazníka uloženy.');}else{newProject(customer.id);notice('Zákazník vytvořen. Zadejte základní informace projektu a kontrolní kroky.');}});};
  $('projectForm').onsubmit=event=>{event.preventDefault();task(async()=>{
    if(!$('editors').children.length)throw new Error('Přidejte alespoň jeden kontrolní krok.');const steps=[];
    for(const card of $('editors').children){const field=key=>card.querySelector(`[data-key="${key}"]`);const type=field('verification_type').value;
      const step={title:field('title').value.trim(),instruction:field('instruction').value.trim(),verification_type:type,kind:type==='visual'?'visual':'scan',rule:type==='visual'?'part':type==='measurement'?'presence':field('rule').value,expected:field('expected').value.trim(),rework_instruction:field('rework_instruction').value.trim(),min_value:type==='measurement'?Number(field('min_value').value):null,max_value:type==='measurement'?Number(field('max_value').value):null,unit:field('unit').value.trim(),image_id:card.imageId};
      if(type==='measurement'&&(!field('min_value').value||!field('max_value').value||!Number.isFinite(step.min_value)||!Number.isFinite(step.max_value)||step.min_value>step.max_value))throw new Error('Zadejte platnou dolní a horní mez měření.');
      const file=field('file').files[0];if(file){if(file.size>4*1024*1024)throw new Error('Příloha překračuje 4 MB.');const image=await api('/admin/images',{data:await readFile(file)},true);step.image_id=image.id;card.imageId=image.id;field('file').value='';}steps.push(step);
    }
    const saved=await api('/admin/projects',{name:$('projectName').value.trim(),customer_id:draftCustomer,code:$('projectCode').value.trim(),description:$('projectDescription').value.trim(),steps},true);await refresh();await detail(saved.id);notice('Projekt uložen. Je v seznamu vlevo; po kontrole jej můžete zveřejnit.');
  });};
  async function download(projectId,format){
    const response=await fetch(`/api/workflow/admin/projects/${projectId}/export?format=${format}`,{headers:{Authorization:`Bearer ${token}`}});
    if(!response.ok){const data=await response.json();throw new Error(data.error||'Export se nezdařil.');}
    const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download=`projekt-${projectId}.${format}`;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);notice('Export připraven ke stažení.');
  }
  $('loginForm').onsubmit=event=>{event.preventDefault();task(async()=>{token=$('adminKey').value;try{await refresh();}catch(error){token='';throw error;}$('adminKey').value='';$('adminLogin').hidden=true;$('adminContent').hidden=false;show('adminWelcome');});};
  $('logout').onclick=()=>{token='';customers=[];projects=[];selectedProject=null;selectedCustomer=null;trashMode=false;expanded.clear();trashButton.textContent='Koš';$('newCustomer').hidden=false;$('customerTree').replaceChildren();$('editors').replaceChildren();$('detailSteps').replaceChildren();$('adminLogin').hidden=false;$('adminContent').hidden=true;};
})();
