import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../extension/content.js',import.meta.url),'utf8');
class Style{setProperty(key,value){this[key]=value;}removeProperty(key){delete this[key];}}
export class Element{
  constructor(type='div',parent=null){this.tagName=type.toUpperCase();this.parentElement=parent;this.style=new Style();this.dataset={};this.children=[];this.handlers=new Map();this.scrollLeft=0;this.scrollTop=0;this.clientTop=0;this.clientLeft=0;this.clientWidth=1000;this.clientHeight=700;this.scrollHeight=700;this.isConnected=true;this.className='';}
  append(...els){for(const el of els){el.parentElement=this;this.children.push(el);}}
  remove(){this.isConnected=false;if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(x=>x!==this);}
  attachShadow(){const shadow=new Element('shadow-root',this);shadow.ownerDocument=this.ownerDocument;return this.shadowRoot=shadow;}
  addEventListener(name,cb){if(!this.handlers.has(name))this.handlers.set(name,new Set());this.handlers.get(name).add(cb);}
  removeEventListener(name,cb){this.handlers.get(name)?.delete(cb);}
  fire(name,values={}){if(name==='wheel'&&this.tagName==='SHADOW-ROOT'&&this.ownerDocument)return this.ownerDocument.fire(name,{...values,composedPath:()=>[this,this.parentElement]});const e={type:name,clientX:500,clientY:350,button:0,pointerId:1,deltaX:0,deltaY:0,deltaMode:0,cancelable:true,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){},target:this,...values};for(const cb of [...this.handlers.get(name)||[]])cb(e);return e;}
  setPointerCapture(){}
  closest(){return null;}
  matches(selector){return this.isPage&&selector.includes('.page');}
  querySelector(selector){const key=selector.slice(1);for(const c of this.children){if(selector.startsWith('.')&&c.className.split(' ').includes(key))return c;const inner=c.querySelector(selector);if(inner)return inner;}return null;}
  getAttribute(name){return name==='data-page-number'&&this.isPage?String(this.pageNumber):null;}
  getBoundingClientRect(){return {x:0,y:0,width:this.clientWidth,height:this.clientHeight};}
  scrollTo({left=0,top=0}){this.scrollLeft=left;this.scrollTop=Math.min(Math.max(0,top),Math.max(0,this.scrollHeight-this.clientHeight));}
}
export function makeViewer(nested=false){
  const html=new Element('html'),body=new Element('body',html),scroller=nested?new Element('div',body):html,document=new Element('document'),window=new Element('window');html.append(body);if(nested)body.append(scroller);
  let scale=1,gapScales=true,frameId=0,time=0;const frames=new Map(),notices=[],messageHandlers=new Set();
  const noticeHandlers=new Set(),bars=[];
  const ctx={document,window,innerWidth:1000,innerHeight:700,devicePixelRatio:1,location:{href:'https://example.test/viewer'},setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);if(ms>10000)t.unref();return t;},clearTimeout,requestAnimationFrame:fn=>{frames.set(++frameId,fn);return frameId;},cancelAnimationFrame:id=>frames.delete(id),chrome:{runtime:{id:'test',onMessage:{addListener:fn=>messageHandlers.add(fn),removeListener:fn=>messageHandlers.delete(fn)},sendMessage:async m=>{notices.push(m);for(const fn of noticeHandlers)fn(m);}}}};
  scroller.getBoundingClientRect=()=>({x:0,y:nested?100:0,width:scroller.clientWidth,height:scroller.clientHeight});
  const pages=Array.from({length:nested?2:3},(_,i)=>{const p=new Element('article',nested?scroller:body);p.isPage=true;p.pageNumber=i+1;p.getBoundingClientRect=()=>({x:(ctx.innerWidth-660*scale)/2,y:(nested?120:90)+i*(940*scale+24*(gapScales?scale:1))-scroller.scrollTop,width:660*scale,height:940*scale});return p;});
  const updateSize=()=>{html.clientWidth=ctx.innerWidth;html.clientHeight=ctx.innerHeight;html.scrollHeight=nested?ctx.innerHeight:90+(pages.length*964-24)*scale+30;scroller.clientWidth=ctx.innerWidth;scroller.clientHeight=nested?ctx.innerHeight-150:ctx.innerHeight;scroller.scrollHeight=nested?20+(pages.length*964-24)*scale+20:html.scrollHeight;for(const p of pages){p.clientWidth=660*scale;p.clientHeight=p.scrollHeight=940*scale;}};updateSize();
  Object.assign(document,{scrollingElement:html,documentElement:html,body,title:'Test viewer',createElement:type=>{const e=new Element(type);e.ownerDocument=document;return e;},querySelectorAll:selector=>selector.includes('.page')?pages.filter(p=>p.isConnected):selector.startsWith('header')?bars:[],elementFromPoint:(x,y)=>[...bars,...pages].find(p=>{const r=p.getBoundingClientRect();return p.isConnected&&x>=r.x&&x<r.x+r.width&&y>=r.y&&y<r.y+r.height;})||body});
  ctx.getComputedStyle=el=>({position:el.position||'static',overflowY:el===scroller&&nested?'auto':'visible',overflow:el===scroller&&nested?'auto':'visible',visibility:'visible',display:'block',backgroundColor:pages.includes(el)?'rgb(255, 255, 255)':'rgba(0, 0, 0, 0)'});
  vm.createContext(ctx);vm.runInContext(source,ctx);
  const send=(op,extra={})=>new Promise((resolve,reject)=>{let found=false;for(const handler of messageHandlers){const accepted=handler({scope:'readercapture',op,opts:{mode:'auto',wait:80,topInset:nested?0:64},...extra},{},r=>r.ok?resolve(r.data):reject(Object.assign(new Error(r.error),{code:r.code})));if(accepted)found=true;}if(!found)reject(new Error('No receiver'));});
  const overlay=()=>{const host=html.children.find(x=>x.dataset.readercapture==='v2');if(!host)return null;const shadow=host.shadowRoot;return {host,shadow,surface:shadow.querySelector('.surface'),frame:shadow.querySelector('.frame'),line:shadow.querySelector('.line')};};
  const tick=(n=1)=>{for(let i=0;i<n;i++){time+=16;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(time));}};
  const flush=()=>new Promise(r=>setTimeout(r,60));
  const events=new Proxy({}, {get:(_,name)=>(values={})=>document.fire(name,values)});
  const setScale=value=>{scale=value;updateSize();window.fire('resize');};
  const setZoom=value=>{ctx.devicePixelRatio=value;ctx.innerWidth=1000/value;ctx.innerHeight=700/value;updateSize();window.fire('resize');};
  const reinject=()=>vm.runInContext(source,ctx);
  const draw=async(rect={x:170,y:90,width:660,height:600})=>{await send('pick',{kind:'manual'});overlay().surface.fire('pointerdown',{clientX:rect.x,clientY:rect.y});document.fire('pointermove',{clientX:rect.x+rect.width,clientY:rect.y+rect.height});document.fire('pointerup',{clientX:rect.x+rect.width,clientY:rect.y+rect.height});await flush();return send('selection');};
  const dispose=()=>ctx.__readerCaptureController.dispose();
  const addBar=rect=>{const el=new Element('header',body);el.position='fixed';el.getBoundingClientRect=()=>({...rect});bars.push(el);return el;};
  return {send,pages,scroller,html,document,window,events,ctx,notices,noticeHandlers,overlay,tick,flush,setScale,setZoom,reinject,draw,dispose,messageHandlers,setFixedGap:()=>gapScales=false,addBar,bars};
}
