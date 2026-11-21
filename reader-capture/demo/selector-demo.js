(() => {
  const listeners=new Set();let index=0;
  const status=document.getElementById('demoStatus');
  window.chrome=window.chrome||{};
  window.chrome.runtime={id:'readercapture-demo',onMessage:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},sendMessage:async message=>{
    if(message.data?.rect){const d=message.data;status.textContent=`${Math.round(d.rect.width)} × ${Math.round(d.rect.height)} px${d.calibrated?' · βήμα '+Math.round(d.step)+' px':' · όρισε την επόμενη αρχή'}`;}
  }};
  const call=(op,extra={})=>new Promise((resolve,reject)=>{let found=false;for(const fn of listeners){if(fn({scope:'readercapture',op,opts:{mode:'manual',wait:150,topInset:0,lockRatio:true,edgeSpeed:950},...extra},{},r=>r.ok?resolve(r.data):reject(new Error(r.error))))found=true;}if(!found)reject(new Error('Ανανέωσε τη δοκιμαστική σελίδα.'));});
  const bind=(id,fn)=>document.getElementById(id).addEventListener('click',async()=>{try{await fn();}catch(e){status.textContent=e.message;}});
  bind('demoDraw',()=>{index=0;return call('pick',{kind:'manual'});});
  bind('demoGap',()=>call('measure-gap'));
  bind('demoFirst',()=>{index=0;return call('goto',{index});});
  bind('demoNext',()=>call('goto',{index:++index}));
  bind('demoHide',()=>call('hide-overlay'));
})();
