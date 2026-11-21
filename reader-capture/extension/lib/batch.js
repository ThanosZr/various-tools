export async function runBatch({first=0,count,prepare,capture,checkStop=()=>{},beforePage=async()=>{},onProgress=()=>{},settle=async()=>{}}){
  if(!Number.isInteger(first)||first<0||!Number.isInteger(count)||count<1||count>1000)throw new Error('Δώσε αρχική θέση ≥ 1 και πλήθος από 1 έως 1000.');
  const result={completed:0,added:0,duplicates:0,first,next:first,reason:'count'};
  try{
    for(let n=0;n<count;n++){
      const index=first+n;await beforePage(index);checkStop();
      for(let retry=0;;retry++){
        try{await prepare(index);checkStop();const record=await capture(index);result.completed++;if(record?.added===false)result.duplicates++;else result.added++;result.next=index+1;onProgress({...result,index,total:count});break;}
        catch(error){if(error.code==='PAGE_END'){result.reason='end';return result;}if(['VIEWPORT_CHANGED','LAYOUT_CHANGED'].includes(error.code)&&retry<3){checkStop();await settle(error,index);continue;}throw error;}
      }
    }
    return result;
  }catch(error){error.batch={...result};throw error;}
}
