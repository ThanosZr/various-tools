export const VERSION='3.0.0';
export function friendlyError(error){
  const text=error?.message||String(error);
  if(/context invalidated|Extension context/i.test(text))return 'Η επέκταση ανανεώθηκε. Κλείσε το παλιό πάνελ, ανανέωσε το έγγραφο και πάτησε ξανά το εικονίδιο ReaderCapture.';
  if(/No tab with id|Invalid tab ID|tab was closed/i.test(text))return 'Η καρτέλα έκλεισε. Άνοιξε το έγγραφο και πάτησε το εικονίδιο ReaderCapture.';
  return text;
}
export class PageBridge{
  constructor(api=globalThis.chrome){this.api=api;}
  async resolve(target){
    const api=this.api;if(!api?.runtime?.id)throw new Error('Extension context invalidated');let tab;
    if(Number.isInteger(target?.id)){try{tab=await api.tabs.get(target.id);}catch{}if(tab&&!tab.active)throw new Error('Επίστρεψε στην καρτέλα του εγγράφου ή πάτησε το εικονίδιο ReaderCapture στη νέα καρτέλα.');}
    if(!tab)[tab]=await api.tabs.query({active:true,currentWindow:true});
    if(!Number.isInteger(tab?.id))throw new Error('Δεν βρέθηκε ενεργή καρτέλα εγγράφου.');
    if(tab.url?.startsWith('chrome-extension:'))throw new Error('Άνοιξε την ιστοσελίδα του εγγράφου και πάτησε εκεί το εικονίδιο ReaderCapture.');
    return {id:tab.id,windowId:tab.windowId,url:tab.url,title:tab.title};
  }
  async ensure(target){
    const t=await this.resolve(target);let ping;try{ping=await this.call('ping',{},t);}catch{}
    if(ping?.version===VERSION)return t;
    try{await this.api.scripting.executeScript({target:{tabId:t.id},files:['content.js']});}
    catch(error){if(t.url?.startsWith('file:'))throw new Error('Ενεργοποίησε «Allow access to file URLs» στις λεπτομέρειες της επέκτασης και πάτησε ξανά το εικονίδιό της.');throw new Error('Δεν δόθηκε πρόσβαση στη σελίδα. Πάτησε το εικονίδιο ReaderCapture πάνω στο έγγραφο. Σε chrome:// και στον PDF viewer χρησιμοποίησε την κανονική λήψη PDF. '+friendlyError(error));}
    const ready=await this.call('ping',{},t);if(ready?.version!==VERSION)throw new Error('Ανανέωσε το έγγραφο για να φορτωθεί η νέα έκδοση ReaderCapture.');return t;
  }
  async call(op,extra={},target){
    if(!Number.isInteger(target?.id))throw new Error('Δεν συνδέθηκε ακόμη το έγγραφο. Πάτησε το εικονίδιο ReaderCapture.');let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error('Ο viewer δεν απάντησε. Ανανέωσε το έγγραφο και πάτησε το εικονίδιο ReaderCapture.'),{code:'VIEWER_TIMEOUT'})),['prepare','goto'].includes(op)?25000:12000);});
    try{const r=await Promise.race([this.api.tabs.sendMessage(target.id,{scope:'readercapture',op,...extra}),timeout]);if(!r?.ok)throw Object.assign(new Error(r?.error||'Δεν απάντησε το έγγραφο.'),{code:r?.code||'VIEWER_ERROR'});return r.data;}finally{clearTimeout(timer);}
  }
}
