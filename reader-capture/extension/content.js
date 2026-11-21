(() => {
  'use strict';
  const VERSION='2.0.0', SLOT='__readerCaptureController';
  try { globalThis[SLOT]?.dispose(); } catch {}
  const removers=[];
  let model=null,view=null,mode='idle',gesture=null,gapPoint=null,capture=null,run=null,raf=0,lastTick=0,pickerOptions={},notifyTimer=0;
  const box=r=>({x:r.x,y:r.y,width:r.width,height:r.height});
  const docRoot=()=>document.scrollingElement||document.documentElement;
  const isDoc=r=>r===docRoot();
  const fail=(message,code='CAPTURE_ERROR')=>Object.assign(new Error(message),{code});
  const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function listen(el,name,fn,options){el.addEventListener(name,fn,options);removers.push(()=>el.removeEventListener(name,fn,options));}
  function send(type,data){try{Promise.resolve(chrome.runtime.sendMessage({type,data,version:VERSION})).catch(()=>{});}catch{}}
  function intersect(a,b){const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y);return {x,y,width:Math.max(0,Math.min(a.x+a.width,b.x+b.width)-x),height:Math.max(0,Math.min(a.y+a.height,b.y+b.height)-y)};}
  function rootFor(el){for(let p=el;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement)if(/auto|scroll/.test(getComputedStyle(p).overflowY)&&p.scrollHeight>p.clientHeight+8)return p;return docRoot();}
  function origin(root){if(isDoc(root))return {x:0,y:0};const r=root.getBoundingClientRect();return {x:r.x+root.clientLeft,y:r.y+root.clientTop};}
  function clipFor(root){let c={x:0,y:0,width:innerWidth,height:innerHeight};if(!isDoc(root)){const o=origin(root);c=intersect(c,{...o,width:root.clientWidth,height:root.clientHeight});for(let p=root.parentElement;p&&p!==document.body;p=p.parentElement)if(/hidden|auto|scroll|clip/.test(getComputedStyle(p).overflow))c=intersect(c,box(p.getBoundingClientRect()));}return c;}
  function localRect(rect,root){const o=origin(root);return {...rect,x:rect.x-o.x+root.scrollLeft,y:rect.y-o.y+root.scrollTop};}
  function screenRect(rect,root){const o=origin(root);return {...rect,x:o.x+rect.x-root.scrollLeft,y:o.y+rect.y-root.scrollTop};}
  function point(e,root){const o=origin(root);return {x:e.clientX-o.x+root.scrollLeft,y:e.clientY-o.y+root.scrollTop};}
  function scroll(root,left,top){root.scrollTo({left,top,behavior:'instant'});}
  function under(x,y){if(view)view.host.style.setProperty('display','none','important');let el;try{el=document.elementFromPoint(x,y);}finally{if(view)view.host.style.removeProperty('display');}return el;}
  const PAGE_SELECTOR='[data-page-number],[data-page-no],.page,.pdf-page,.document-page,.document_page,.pf,.slide';
  function candidates(){
    const found=new Set(document.querySelectorAll(PAGE_SELECTOR+',canvas'));
    for(const x of [.3,.5,.7])for(let p=under(innerWidth*x,innerHeight*.5),i=0;p&&i<6;p=p.parentElement,i++)found.add(p);
    const list=[],seen=new Set();
    for(let el of found){
      if(el.tagName==='CANVAS'&&el.parentElement)el=el.parentElement;
      if(seen.has(el)||el===document.body||el===document.documentElement||el.closest?.('[data-readercapture]'))continue;seen.add(el);
      const r=box(el.getBoundingClientRect()),c=getComputedStyle(el),ratio=r.width/r.height;
      if(r.width<100||r.height<100||ratio<.2||ratio>3||r.height>30000||c.visibility==='hidden'||c.display==='none')continue;
      if(el.scrollHeight>el.clientHeight+20&&/auto|scroll/.test(c.overflowY))continue;
      const explicit=el.matches(PAGE_SELECTOR),white=/rgb\(25[0-5], 25[0-5], 25[0-5]\)/.test(c.backgroundColor);
      if(!explicit&&!white&&!el.querySelector('canvas'))continue;
      const visible=intersect(r,clipFor(rootFor(el))),area=visible.width*visible.height;
      list.push({el,rect:r,score:(explicit?5:0)+(white?1:0)+area/(r.width*Math.min(innerHeight,r.height)||1)*4-Math.abs(r.y+r.height/2-innerHeight/2)/Math.max(innerHeight,r.height)});
    }
    return list.sort((a,b)=>b.score-a.score);
  }
  function referenceFor(el,rect){
    let fallback=null;
    for(let p=el;p&&p!==document.body&&p!==document.documentElement;p=p.parentElement){const r=p.getBoundingClientRect();if(p.matches?.(PAGE_SELECTOR))return p;if(!fallback&&r.width>=rect.width*.75&&r.width<=rect.width*2.5&&r.height>=100&&r.width/r.height>.2&&r.width/r.height<3&&!/auto|scroll/.test(getComputedStyle(p).overflowY))fallback=p;}
    return fallback;
  }
  function createModel(rect,root,ref,step=null){
    const local=localRect(rect,root),a=ref?.isConnected?localRect(box(ref.getBoundingClientRect()),root):null;
    model={root,ref:ref||null,nextRef:null,nextOffsetY:0,fixedGap:null,baseRefWidth:a?.width||0,refOffsetX:a?local.x-a.x:0,refOffsetY:a?local.y-a.y:0,base:{...local},step:step||rect.height+16,calibrated:step!==null,lastScale:1,lastLocal:{...local}};return model;
  }
  function geometry(){
    if(!model)throw fail('Σχεδίασε πρώτα την περιοχή μιας σελίδας.','NO_SELECTION');
    if(!model.root.isConnected)throw fail('Ο viewer άλλαξε. Σχεδίασε ξανά την περιοχή.','VIEWER_CHANGED');
    let scale=1,x=model.base.x,y=model.base.y,tracking='css';
    if(model.ref?.isConnected&&model.baseRefWidth>0){const a=localRect(box(model.ref.getBoundingClientRect()),model.root);scale=a.width/model.baseRefWidth;if(!(scale>.05&&scale<20))throw fail('Περίμενε να φορτώσουν οι διαστάσεις της σελίδας.','LAYOUT_CHANGED');x=a.x+model.refOffsetX*scale;y=a.y+model.refOffsetY*scale;tracking='page';}
    else if(model.ref){scale=model.lastScale;x=model.lastLocal.x;y=model.lastLocal.y;tracking='cached';}
    const local={x,y,width:model.base.width*scale,height:model.base.height*scale};let step=model.step*scale;
    if(model.nextRef?.isConnected){const next=localRect(box(model.nextRef.getBoundingClientRect()),model.root);step=next.y+model.nextOffsetY*scale-local.y;model.step=step/scale;}
    else if(model.fixedGap!==null)step=local.height+model.fixedGap;
    model.lastScale=scale;model.lastLocal={...local};return {local,rect:screenRect(local,model.root),step,gap:step-local.height,scale,tracking};
  }
  function setGeometry(values){
    const g=geometry(),n={...g.local};
    for(const key of ['width','height'])if(values[key]!==undefined){const v=Number(values[key]);if(!Number.isFinite(v)||v<30||v>30000)throw fail('Πλάτος και ύψος: από 30 έως 30.000 px.');n[key]=v;}
    const step=values.step!==undefined?Number(values.step):values.gap!==undefined?n.height+Number(values.gap):g.step;
    if(!Number.isFinite(step)||step<30)throw fail('Το βήμα πρέπει να είναι τουλάχιστον 30 px.');
    model.base.width=n.width/g.scale;model.base.height=n.height/g.scale;model.step=step/g.scale;
    if(values.step!==undefined||values.gap!==undefined){model.nextRef=null;model.fixedGap=values.gap!==undefined?Number(values.gap):null;}
    if(values.step!==undefined||values.gap!==undefined)model.calibrated=true;repaint();notify();return summary();
  }
  function setLocal(rect){
    const g=geometry(),s=g.scale;
    if(model.nextRef)model.nextOffsetY+=(rect.y-g.local.y)/s;
    if(model.ref?.isConnected){const a=localRect(box(model.ref.getBoundingClientRect()),model.root);model.refOffsetX=(rect.x-a.x)/s;model.refOffsetY=(rect.y-a.y)/s;}
    model.base={x:rect.x,y:rect.y,width:rect.width/s,height:rect.height/s};if(model.calibrated&&rect.height>g.step+2){model.calibrated=false;model.nextRef=null;model.fixedGap=null;}if(!model.calibrated)model.step=model.base.height+16;model.lastLocal={...rect};
  }
  function indexAtView(){const g=geometry(),c=clipFor(model.root),o=origin(model.root),center=c.y+Math.min(c.height/2,g.local.height/2)-o.y+model.root.scrollTop;return Math.max(0,Math.round((center-g.local.y-g.local.height/2)/g.step));}
  function manualTarget(index){const g=geometry(),i=Number.isInteger(index)&&index>=0?index:indexAtView(),local={...g.local,y:g.local.y+i*g.step};return {root:model.root,rect:screenRect(local,model.root),local,kind:'manual',index:i,label:String(i+1),scale:g.scale};}
  function getTarget(opts={}){
    if(opts.mode==='manual'||Number.isInteger(opts.index))return manualTarget(opts.index);
    const found=candidates().find(c=>c.rect.y<innerHeight&&c.rect.y+c.rect.height>0);if(!found)throw fail('Δεν εντοπίστηκε σελίδα. Πάτησε «Σχεδίαση περιοχής».','NO_SELECTION');
    return {el:found.el,root:rootFor(found.el),rect:found.rect,kind:'element',label:found.el.getAttribute('data-page-number')||found.el.getAttribute('data-page-no')||''};
  }
  function info(t){return {rect:t.rect,clip:clipFor(t.root),viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},label:t.label,kind:t.kind,url:location.href,title:document.title,index:t.index};}
  function summary(){const g=geometry();return {...info(manualTarget(0)),step:g.step,gap:g.gap,scale:g.scale,tracking:g.tracking,calibrated:model.calibrated,aspect:g.local.width/g.local.height};}
  function notify(type='bounds-changed'){clearTimeout(notifyTimer);notifyTimer=setTimeout(()=>{try{send(type,summary());}catch{}},40);}
  function hideOverlay(hidden){if(view)view.host.style.setProperty('visibility',hidden?'hidden':'visible','important');}
  function closeView(){if(raf)cancelAnimationFrame(raf);raf=0;gesture=null;view?.host.remove();view=null;mode='idle';gapPoint=null;}
  function buildView(){
    if(view)return view;
    const host=document.createElement('div');host.dataset.readercapture='v2';
    for(const [name,value]of Object.entries({all:'initial',position:'fixed',inset:'0','z-index':'2147483647','pointer-events':'none'}))host.style.setProperty(name,value,'important');
    const shadow=host.attachShadow({mode:'open'}),style=document.createElement('style');
    style.textContent=`:host{all:initial}*{box-sizing:border-box}.surface{position:fixed;inset:0;pointer-events:none;touch-action:none;cursor:crosshair}.surface.active{pointer-events:auto;background:#07142212}.frame{position:fixed;border:2px solid #38db9c;background:#38db9c10;pointer-events:auto;cursor:move;touch-action:none}.frame.red{border:2px dashed #ff4d64;background:#ff4d641c;pointer-events:none}.ghost{position:fixed;border:2px dashed #61b8ff;background:#61b8ff08;pointer-events:none}.handle{position:absolute;width:12px;height:12px;border:2px solid white;background:#16b87e;pointer-events:auto;border-radius:2px}.tools{position:fixed;left:50%;top:10px;transform:translateX(-50%);max-width:calc(100vw - 24px);background:#fff;color:#2b3c49;border:1px solid #becbd5;border-radius:3px;box-shadow:0 3px 12px #243b5326;padding:10px 12px;font:13px/1.4 Calibri,Carlito,Segoe UI,Arial,sans-serif;pointer-events:auto;display:flex;align-items:center;gap:9px;flex-wrap:wrap}.tools p{margin:0;flex:1;min-width:120px;max-width:430px}.tools button{font:600 12px Calibri,Carlito,Segoe UI,Arial,sans-serif;border:1px solid #bfcbd5;border-radius:3px;background:#f5f7f9;color:#334a5c;padding:7px 9px;cursor:pointer}.tools button.primary{background:#1769a5;color:white;border-color:#1769a5}.badge{position:fixed;pointer-events:none;background:#fff;color:#26724d;border:1px solid #83b79f;border-radius:2px;padding:5px 8px;font:12px Calibri,Carlito,Segoe UI,Arial,sans-serif;white-space:nowrap}.line{position:fixed;left:0;right:0;border-top:2px dashed #ff586e;pointer-events:none}.line.valid{border-color:#43dbac}[hidden]{display:none!important}`;
    const surface=document.createElement('div');surface.className='surface';const frame=document.createElement('div');frame.className='frame';frame.hidden=true;
    const ghost=document.createElement('div');ghost.className='ghost';ghost.hidden=true;const badge=document.createElement('div');badge.className='badge';badge.hidden=true;const line=document.createElement('div');line.className='line';line.hidden=true;
    const tools=document.createElement('div');tools.className='tools';const help=document.createElement('p');
    const gap=document.createElement('button');gap.textContent='Επόμενη αρχή';gap.className='primary';gap.addEventListener('click',e=>{consume(e);startGap();});
    const done=document.createElement('button');done.textContent='Έτοιμο';done.addEventListener('click',e=>{consume(e);mode='edit';repaint();notify('bounds-selected');});
    const close=document.createElement('button');close.textContent='×';close.title='Απόκρυψη πλαισίου';close.addEventListener('click',e=>{consume(e);closeView();});
    tools.append(help,gap,done,close);shadow.append(style,surface,ghost,frame,line,badge,tools);document.documentElement.append(host);
    const handles={nw:['0%','0%','nwse-resize'],n:['50%','0%','ns-resize'],ne:['100%','0%','nesw-resize'],e:['100%','50%','ew-resize'],se:['100%','100%','nwse-resize'],s:['50%','100%','ns-resize'],sw:['0%','100%','nesw-resize'],w:['0%','50%','ew-resize']};
    for(const [name,[left,top,cursor]]of Object.entries(handles)){const h=document.createElement('span');h.className='handle';h.dataset.handle=name;Object.assign(h.style,{left,top,cursor,transform:'translate(-50%,-50%)'});frame.append(h);h.addEventListener('pointerdown',e=>beginAdjust(e,name));}
    surface.addEventListener('pointerdown',down);frame.addEventListener('pointerdown',e=>{if(e.target===frame)beginAdjust(e,'move');});shadow.addEventListener('wheel',wheel,{passive:false});
    view={host,shadow,surface,frame,ghost,badge,line,tools,help,gap,done};return view;
  }
  function consume(e){e.preventDefault();e.stopPropagation();}
  function place(el,r){Object.assign(el.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});}
  function repaint(){
    if(!view)return;const v=view;
    v.surface.className='surface'+(['draw','element','gap'].includes(mode)?' active':'');v.frame.style.pointerEvents=mode==='edit'?'auto':'none';v.gap.hidden=!model||mode==='gap'||!!gesture;v.done.hidden=!model||mode==='draw'||mode==='element'||!!gesture;v.tools.style.opacity=gesture?'.45':'1';v.tools.style.pointerEvents=gesture?'none':'auto';
    v.help.textContent=mode==='draw'?'Σύρε για μία σελίδα. Στο άκρο κυλά μόνη της. Esc: ακύρωση.':mode==='element'?'Δείξε μία σελίδα και κάνε κλικ.':mode==='gap'?'Κύλα στην επόμενη σελίδα και κάνε κλικ στην αρχή της.':'Πράσινη περιοχή: μετακίνηση και αλλαγή μεγέθους. Μετά όρισε την επόμενη αρχή.';
    const currentIndex=model&&mode==='edit'?(gesture?.index??indexAtView()):0;
    let r=null;if(gesture&&gesture.type!=='element')r=screenRect(gesture.rect,gesture.root);else if(gesture?.type==='element')r=gesture.rect;else if(model){try{const g=geometry();r={...g.rect,y:g.rect.y+currentIndex*g.step};}catch{}}
    v.frame.hidden=!r;v.badge.hidden=!r;
    if(r){place(v.frame,r);v.frame.className='frame'+(mode==='draw'||mode==='element'?' red':'');v.badge.textContent=`${Math.round(r.width)} × ${Math.round(r.height)} px${model?.calibrated?' · θέση '+(currentIndex+1)+' · βήμα '+Math.round(geometry().step)+' px':''}`;Object.assign(v.badge.style,{left:clamp(r.x,4,innerWidth-280)+'px',top:clamp(r.y-29,72,innerHeight-30)+'px'});}
    v.ghost.hidden=!model||!model.calibrated||mode==='draw'||mode==='element';if(!v.ghost.hidden){const g=geometry();place(v.ghost,{...g.rect,y:g.rect.y+(currentIndex+1)*g.step});}
    v.line.hidden=mode!=='gap'||!gapPoint;if(!v.line.hidden){v.line.style.top=gapPoint.clientY+'px';const g=geometry(),p=point(gapPoint,model.root),delta=p.y-g.local.y;v.line.className='line'+(delta>=g.local.height-2?' valid':'');v.help.textContent=`Κλικ στην επόμενη αρχή · βήμα ${Math.round(delta)} px · διάκενο ${Math.round(delta-g.local.height)} px`;}
  }
  function startDraw(kind='manual',options={}){if(capture||run)throw fail('Σταμάτησε πρώτα τη λήψη.');pickerOptions=options;buildView();mode=kind==='element'?'element':'draw';gesture=null;gapPoint=null;repaint();return {ok:true};}
  function startGap(){if(!model)throw fail('Σχεδίασε πρώτα την πρώτη σελίδα.');buildView();mode='gap';gesture=null;gapPoint=null;repaint();return summary();}
  function down(e){
    if(e.button!==undefined&&e.button!==0)return;consume(e);
    if(mode==='gap'){const g=geometry(),p=point(e,model.root),step=p.y-g.local.y;if(step<g.local.height-2){view.help.textContent='Η επόμενη αρχή πρέπει να βρίσκεται μετά την πράσινη περιοχή. Κύλα χαμηλότερα.';return;}const ref=referenceFor(under(e.clientX,e.clientY),g.rect);model.nextRef=ref&&ref!==model.ref?ref:null;model.nextOffsetY=model.nextRef?(p.y-localRect(box(model.nextRef.getBoundingClientRect()),model.root).y)/g.scale:0;model.fixedGap=null;model.step=step/g.scale;model.calibrated=true;mode='edit';gapPoint=null;repaint();notify('spacing-selected');return;}
    if(mode==='element'){const el=referenceFor(under(e.clientX,e.clientY),{width:100,height:100})||candidates()[0]?.el;if(el){const r=box(el.getBoundingClientRect());createModel(r,rootFor(el),el);mode='edit';inferSpacing(el);repaint();notify('bounds-selected');}return;}
    if(mode!=='draw')return;
    const el=under(e.clientX,e.clientY),root=rootFor(el),p=point(e,root);gesture={type:'draw',root,start:p,pointer:{clientX:e.clientX,clientY:e.clientY},rect:{x:p.x,y:p.y,width:0,height:0},under:el};try{view.surface.setPointerCapture(e.pointerId);}catch{}startEdge();repaint();
  }
  function beginAdjust(e,handle){if(mode!=='edit'||!model)return;consume(e);const g=geometry(),index=indexAtView(),local={...g.local,y:g.local.y+index*g.step};gesture={type:handle==='move'?'move':'resize',handle,index,step:g.step,root:model.root,start:point(e,model.root),pointer:{clientX:e.clientX,clientY:e.clientY},initial:local,rect:{...local},ratio:g.local.width/g.local.height};try{e.target.setPointerCapture(e.pointerId);}catch{}startEdge();}
  function updateGesture(){
    if(!gesture)return;const g=gesture,p=point(g.pointer,g.root);
    if(g.type==='draw')g.rect={x:Math.min(g.start.x,p.x),y:Math.min(g.start.y,p.y),width:Math.abs(p.x-g.start.x),height:Math.abs(p.y-g.start.y)};
    else if(g.type==='move'){const r={...g.initial,x:Math.max(0,g.initial.x+p.x-g.start.x),y:Math.max(0,g.initial.y+p.y-g.start.y)};g.rect=r;setLocal({...r,y:r.y-g.index*g.step});}
    else if(g.type==='resize'){
      const a=g.initial,h=g.handle,dx=p.x-g.start.x,dy=p.y-g.start.y;let left=a.x,right=a.x+a.width,top=a.y,bottom=a.y+a.height;
      if(h.includes('w'))left=Math.min(right-30,left+dx);if(h.includes('e'))right=Math.max(left+30,right+dx);if(h.includes('n'))top=Math.min(bottom-30,top+dy);if(h.includes('s'))bottom=Math.max(top+30,bottom+dy);
      if((pickerOptions.lockRatio!==false||g.pointer.shiftKey)&&h.length===2){let width=right-left,height=bottom-top;if(Math.abs(dx)>Math.abs(dy)*g.ratio)height=width/g.ratio;else width=height*g.ratio;if(h.includes('w'))left=right-width;else right=left+width;if(h.includes('n'))top=bottom-height;else bottom=top+height;}
      const r={x:Math.max(0,left),y:Math.max(0,top),width:right-left,height:bottom-top};g.rect=r;setLocal({...r,y:r.y-g.index*g.step});
    }
    repaint();
  }
  function onMove(e){if(gesture){consume(e);gesture.pointer={clientX:e.clientX,clientY:e.clientY,shiftKey:e.shiftKey};updateGesture();return;}if(mode==='gap'){gapPoint={clientX:e.clientX,clientY:e.clientY};repaint();}if(mode==='element'){const el=referenceFor(under(e.clientX,e.clientY),{width:100,height:100});if(el){gesture={type:'element',rect:box(el.getBoundingClientRect())};repaint();gesture=null;}}}
  function onUp(e){if(!gesture||gesture.type==='element')return;consume(e);gesture.pointer={clientX:e.clientX,clientY:e.clientY,shiftKey:e.shiftKey};updateGesture();const g=gesture;gesture=null;if(raf)cancelAnimationFrame(raf);raf=0;if(g.rect.width<30||g.rect.height<30){repaint();return;}if(g.type==='draw'){const rect=screenRect(g.rect,g.root);createModel(rect,g.root,referenceFor(g.under,rect));}mode='edit';repaint();notify('bounds-selected');}
  function startEdge(){if(raf)return;lastTick=0;raf=requestAnimationFrame(edgeTick);}
  function edgeTick(time){
    raf=0;if(!gesture||gesture.type==='element')return;const g=gesture,c=clipFor(g.root),p=g.pointer,margin=Math.min(72,c.height/4),dt=lastTick?Math.min(.048,(time-lastTick)/1000):.016;lastTick=time;
    let factor=0;if(p.clientX>=c.x-20&&p.clientX<=c.x+c.width+20){if(p.clientY>c.y+c.height-margin)factor=clamp((p.clientY-(c.y+c.height-margin))/margin,0,1);else if(p.clientY<c.y+margin)factor=-clamp((c.y+margin-p.clientY)/margin,0,1);}
    const speed=clamp(Number(pickerOptions.edgeSpeed)||950,100,2400);if(factor){scroll(g.root,g.root.scrollLeft,g.root.scrollTop+factor*speed*dt);updateGesture();}raf=requestAnimationFrame(edgeTick);
  }
  function wheel(e){if(!view||e.ctrlKey||e.metaKey)return;const root=gesture?.root||model?.root||rootFor(under(e.clientX,e.clientY));consume(e);const multiplier=e.deltaMode===1?20:e.deltaMode===2?clipFor(root).height:1;scroll(root,root.scrollLeft+(e.deltaX||0)*multiplier,root.scrollTop+(e.deltaY||0)*multiplier);updateGesture();repaint();}
  function inferSpacing(el){const rect=el.getBoundingClientRect(),next=candidates().filter(c=>c.el!==el&&c.rect.width>rect.width*.9&&c.rect.width<rect.width*1.1&&c.rect.y>=rect.y+rect.height-2).sort((a,b)=>a.rect.y-b.rect.y)[0];if(next){model.step=next.rect.y-rect.y;model.nextRef=next.el;model.nextOffsetY=0;model.calibrated=true;}}
  function viewChanged(){if(view&&!capture&&!run){repaint();if(model)notify();}}
  function rememberPosition(root){const g=model&&root===model.root?geometry():null;return {root,left:root.scrollLeft,top:root.scrollTop,anchor:g?.local.y,anchorX:g?.local.x,scale:g?.scale||1};}
  function restorePosition(position){if(!position?.root.isConnected)return;let left=position.left,top=position.top;if(model&&position.root===model.root&&position.anchor!==undefined){const g=geometry(),factor=g.scale/position.scale;top=g.local.y+(position.top-position.anchor)*factor;left=g.local.x+(position.left-position.anchorX)*factor;}scroll(position.root,left,top);}
  function guardInput(e){if(!capture)return;if((e.ctrlKey||e.metaKey)&&(e.type==='wheel'||['Control','Meta','+','-','=','0'].includes(e.key)))return;capture.cancelled=true;if(run)run.cancelled=true;if(e.type==='keydown'&&e.key==='Escape')send('capture-cancelled');}
  function currentCapture(){
    if(!capture)throw fail('Η λήψη έχει λήξει.','CAPTURE_EXPIRED');const s=capture,t=s.target;
    if(s.cancelled||run?.cancelled)throw fail('Η λήψη διακόπηκε από κίνηση ή πλήκτρο στο έγγραφο.','USER_INTERRUPTED');
    if(innerWidth!==s.vw||innerHeight!==s.vh||Math.abs(devicePixelRatio-s.dpr)>.001)throw fail('Άλλαξε το zoom ή το παράθυρο. Επαναπροσδιορισμός της ίδιας σελίδας…','VIEWPORT_CHANGED');
    const rect={...s.rect,x:s.rect.x-(t.root.scrollLeft-s.left),y:s.rect.y-(t.root.scrollTop-s.top)};
    if(!t.root.isConnected)throw fail('Ο viewer άλλαξε κατά τη λήψη.','VIEWER_CHANGED');
    if(t.el){const actual=t.el.getBoundingClientRect();if(Math.abs(actual.width-rect.width)>2||Math.abs(actual.height-rect.height)>2||Math.abs(actual.y-rect.y)>3)throw fail('Η διάταξη άλλαξε κατά τη λήψη.','LAYOUT_CHANGED');}
    if(t.kind==='manual'&&Math.abs(geometry().scale-t.scale)>.002)throw fail('Η σελίδα άλλαξε μέγεθος. Επανάληψη λήψης…','VIEWPORT_CHANGED');
    const c=clipFor(t.root),upper=Math.max(c.y,Number(s.opts.topInset)||0),lower=Math.min(c.y+c.height,innerHeight-(Number(s.opts.bottomInset)||0));return {...info({...t,rect}),clip:{x:c.x,y:upper,width:c.width,height:Math.max(0,lower-upper)}};
  }
  function endCapture(restore=true){if(!capture)return {ok:true};const s=capture;capture=null;clearTimeout(s.timer);if(restore)restorePosition(s.position);if(!run)hideOverlay(false);return {ok:true};}
  async function prepare(index,opts){
    let previous=-1,stable=0;
    for(let n=0;n<6;n++){const t=manualTarget(index),root=t.root,c=clipFor(root),top=Math.max(c.y,Number(opts.topInset)||0)+24;scroll(root,root.scrollLeft,root.scrollTop+t.rect.y-top);await wait(clamp(Number(opts.wait)||450,80,3000));const current=manualTarget(index),bottom=current.local.y+current.local.height;if(bottom<=root.scrollHeight+2)return info(current);if(root.scrollHeight===previous)stable++;else stable=0;previous=root.scrollHeight;if(stable>=2)break;}
    throw fail('Δεν χωρά άλλη πλήρης σελίδα στο τέλος του εγγράφου.','PAGE_END');
  }
  async function handle(message){
    const {op,opts={}}=message;
    if(op==='ping')return {version:VERSION,selected:!!model};
    if(op==='configure'){pickerOptions={...pickerOptions,...opts};return {ok:true};}
    if(op==='pick')return startDraw(message.kind,opts);
    if(op==='measure-gap')return startGap();
    if(op==='set-geometry')return setGeometry(message.values||{});
    if(op==='selection')return model?summary():null;
    if(op==='show-overlay'){buildView();mode='edit';repaint();hideOverlay(false);return model?summary():null;}
    if(op==='hide-overlay'){closeView();return {ok:true};}
    if(op==='cancel-picker'){gesture=null;if(raf)cancelAnimationFrame(raf);raf=0;if(model){mode='edit';repaint();}else closeView();return {ok:true};}
    if(op==='calibrate-auto'){const t=getTarget({mode:'auto'});createModel(t.rect,t.root,t.el);inferSpacing(t.el);buildView();mode='edit';repaint();notify('bounds-selected');return summary();}
    if(op==='inspect'){const t=getTarget(opts);if(message.flash&&model){buildView();mode='edit';repaint();}return info(t);}
    if(op==='begin-run'){if(!model||!model.calibrated)throw fail('Όρισε πρώτα την περιοχή και την αρχή της επόμενης σελίδας.','NOT_CALIBRATED');endCapture();run={position:rememberPosition(model.root),cancelled:false};hideOverlay(true);return summary();}
    if(op==='end-run'){endCapture(false);const r=run;run=null;if(message.restore!==false&&r)restorePosition(r.position);hideOverlay(false);repaint();return {ok:true};}
    if(op==='prepare')return prepare(message.index,opts);
    if(op==='goto'){const m=await prepare(message.index,opts);repaint();return m;}
    if(op==='begin'){endCapture(!run);if(gesture)throw fail('Ολοκλήρωσε πρώτα τη σχεδίαση.');const t=getTarget(opts);if(run?.cancelled)throw fail('Η λήψη διακόπηκε.','USER_INTERRUPTED');capture={target:t,rect:{...t.rect},left:t.root.scrollLeft,top:t.root.scrollTop,vw:innerWidth,vh:innerHeight,dpr:devicePixelRatio,opts,cancelled:false,position:rememberPosition(t.root)};capture.timer=setTimeout(()=>endCapture(!run),120000);hideOverlay(true);return currentCapture();}
    if(op==='move'){const s=capture,m=currentCapture();if(m.clip.height<80)throw fail('Η ορατή περιοχή είναι πολύ μικρή. Μείωσε τα περιθώρια.');scroll(s.target.root,s.target.root.scrollLeft,s.target.root.scrollTop+m.rect.y+message.covered-m.clip.y-24);await wait(clamp(Number(opts.wait)||450,80,3000));return currentCapture();}
    if(op==='metrics')return currentCapture();
    if(op==='end')return endCapture(message.restore!==false&&!run);
    if(op==='next'){
      if(opts.mode==='manual'&&model){const m=await prepare(Math.max(0,indexAtView()+(message.direction||1)),opts);repaint();return m;}
      const t=getTarget(opts),direction=message.direction||1,list=candidates().filter(c=>c.el!==t.el&&Math.abs(c.rect.width-t.rect.width)<t.rect.width*.15&&(c.rect.y-t.rect.y)*direction>t.rect.height*.5).sort((a,b)=>Math.abs(a.rect.y-t.rect.y)-Math.abs(b.rect.y-t.rect.y)),next=list[0],dy=next?next.rect.y-t.rect.y:(t.rect.height+Math.max(0,Number(opts.gap)||0))*direction,c=clipFor(t.root);
      scroll(t.root,t.root.scrollLeft,t.root.scrollTop+t.rect.y+dy-Math.max(c.y,Number(opts.topInset)||0)-8);await wait(150);repaint();return {ok:true};
    }
    if(op==='links'){const links=[];for(const el of document.querySelectorAll('a[href],embed[src],object[data]')){const raw=el.getAttribute('href')||el.getAttribute('src')||el.getAttribute('data');try{const url=new URL(raw,location.href);if(/^https?:$/.test(url.protocol)&&/\.pdf(?:$|[?#])/i.test(url.href)&&!links.some(l=>l.url===url.href))links.push({url:url.href,label:(el.textContent||'PDF').trim().slice(0,100)});}catch{}}return links.slice(0,30);}
    throw fail('Άγνωστη εντολή. Ανανέωσε την επέκταση και τη σελίδα.','VERSION_MISMATCH');
  }
  const onMessage=(m,sender,respond)=>{if(m?.scope!=='readercapture')return;handle(m).then(data=>respond({ok:true,data}),e=>respond({ok:false,error:e.message,code:e.code||'CAPTURE_ERROR'}));return true;};
  chrome.runtime.onMessage.addListener(onMessage);
  listen(document,'pointermove',onMove,true);listen(document,'pointerup',onUp,true);
  listen(document,'pointercancel',()=>{gesture=null;if(raf)cancelAnimationFrame(raf);raf=0;repaint();},true);
  for(const name of ['wheel','touchstart','pointerdown','keydown'])listen(document,name,guardInput,{capture:true,passive:true});
  listen(document,'keydown',e=>{if(e.key==='Escape'&&!capture){gesture=null;if(model){mode='edit';repaint();}else closeView();send('selection-cancelled');}},true);
  listen(document,'scroll',viewChanged,true);listen(window,'resize',viewChanged);if(window.visualViewport)listen(window.visualViewport,'resize',viewChanged);
  globalThis[SLOT]={version:VERSION,dispose(){endCapture(!run);if(run)restorePosition(run.position);run=null;closeView();clearTimeout(notifyTimer);for(const off of removers)off();try{chrome.runtime.onMessage.removeListener(onMessage);}catch{}}};
})();
