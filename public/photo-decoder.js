'use strict';
(function(root){
  // Celý snímek v několika měřítkách, potom střed a překrývající se rohy.
  function regions(width,height){
    const list=[{x:0,y:0,w:width,h:height,max:1200},{x:0,y:0,w:width,h:height,max:2200}];
    for(const fraction of [0.7,0.4])list.push({x:width*(1-fraction)/2,y:height*(1-fraction)/2,w:width*fraction,h:height*fraction,max:1400});
    for(const x of [0,0.4])for(const y of [0,0.4])list.push({x:width*x,y:height*y,w:width*0.6,h:height*0.6,max:1400});
    if(width>height*1.4)for(let i=0;i<3;i++)list.push({x:width*i/3,y:0,w:width/3,h:height,max:1400});
    return list;
  }
  async function decodeQrImage(image,options={}){
    const decode=options.decode||root.jsQR;
    if(typeof decode!=='function')return null;
    const createCanvas=options.createCanvas||(()=>document.createElement('canvas'));
    const isActive=options.isActive||(()=>true),seen=new Set(),found=new Map();
    const canvas=createCanvas(),context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)throw new Error('Prohlížeč nedovolil zpracování fotografie.');
    try {
      for(const region of regions(image.naturalWidth,image.naturalHeight)){
        if(!isActive())return null;
        const scale=Math.min(1,region.max/Math.max(region.w,region.h));
        const width=Math.max(1,Math.round(region.w*scale)),height=Math.max(1,Math.round(region.h*scale));
        const key=[region.x,region.y,region.w,region.h,width,height].join(':');if(seen.has(key))continue;seen.add(key);
        canvas.width=width;canvas.height=height;context.fillStyle='#fff';context.fillRect(0,0,width,height);
        context.drawImage(image,region.x,region.y,region.w,region.h,0,0,width,height);
        const pixels=context.getImageData(0,0,width,height);
        for(let attempt=0;attempt<4;attempt++){
          const result=decode(pixels.data,width,height,{inversionAttempts:'attemptBoth'});
          if(!result||typeof result.data!=='string'||!result.data.length)break;
          const canonical=result.data.replace(/[\r\n]+$/u,'');found.set(canonical,result.data);
          if(found.size>1)throw new Error('Na fotografii jsou různé QR kódy. Vyfoťte pouze jeden — OK, NOK nebo REWORK. Nic nebylo uloženo.');
          const corners=result.location&&['topLeftCorner','topRightCorner','bottomLeftCorner','bottomRightCorner'].map(key=>result.location[key]);
          if(!corners||corners.some(p=>!p))break;
          const left=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.x)))-3),right=Math.min(width,Math.ceil(Math.max(...corners.map(p=>p.x)))+3);
          const top=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.y)))-3),bottom=Math.min(height,Math.ceil(Math.max(...corners.map(p=>p.y)))+3);
          for(let y=top;y<bottom;y++)for(let x=left;x<right;x++){const i=(y*width+x)*4;pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=255;}
        }
        // Umožní překreslit stav a zavřít dialog i u větší fotografie.
        await new Promise(resolve=>setTimeout(resolve,0));
      }
      return found.size?[...found.values()][0]:null;
    } finally {canvas.width=0;canvas.height=0;}
  }
  const api={decodeQrImage,regions};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PhotoDecoder=api;
})(globalThis);
