// Production services are never contacted. Code under review is loaded from the pinned local checkout.
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const root=path.resolve(__dirname,'..');
const checks=[];
function check(ok,label){assert.ok(ok,label);checks.push(label)}
const tick=async()=>{for(let i=0;i<15;i++)await Promise.resolve()};
async function workerCheck(){
 const source=fs.readFileSync(path.join(root,'push-server/worker.js'),'utf8');
 const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const entries=new Map(),count={get:0,put:0};
 const env={KV:{async get(k){count.get++;return entries.has(k)?JSON.parse(entries.get(k)):null},async put(k,v){count.put++;entries.set(k,v)}}};
 const request=(method,p,body)=>mod.default.fetch(new Request('https://test.invalid'+p,{method,headers:method==='POST'?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})}),env);
 const results=[];
 async function measure(label,fn){const b={...count};const res=await fn();results.push({label,status:res.status,kvReads:count.get-b.get,kvWrites:count.put-b.put});return res}
 await measure('OPTIONS preflight',()=>request('OPTIONS','/notify'));
 await measure('GET summary before first record',()=>request('GET','/summary?fid=AAAAAAAAAA'));
 await measure('notify without registered devices',()=>request('POST','/notify',{fid:'AAAAAAAAAA',summary:{at:100,name:'test'}}));
 await measure('same summary with newer at',()=>request('POST','/notify',{fid:'AAAAAAAAAA',summary:{at:101,name:'test'}}));
 await measure('same summary and equal at',()=>request('POST','/notify',{fid:'AAAAAAAAAA',summary:{at:101,name:'test'}}));
 await measure('stale summary',()=>request('POST','/notify',{fid:'AAAAAAAAAA',summary:{at:99,name:'test'}}));
 await measure('register new token',()=>request('POST','/register',{fid:'BBBBBBBBBB',token:'a'.repeat(30)}));
 await measure('register same token again',()=>request('POST','/register',{fid:'BBBBBBBBBB',token:'a'.repeat(30)}));
 check(results[2].kvWrites===1&&results[2].kvReads===2,'No-recipient notify still performs 2 KV reads and 1 write');
 check(results[3].kvWrites===1&&results[4].kvWrites===1,'Unchanged payload is written again including equal at');
 check(results[5].kvWrites===0,'Older at skips KV write');
 check(results[7].kvWrites===0,'Already registered token avoids KV write');
 return results;
}
function canonical(v){return JSON.stringify(v,(k,x)=>(x&&typeof x==='object'&&!Array.isArray(x))?Object.keys(x).sort().reduce((o,k)=>(o[k]=x[k],o),{}):x)}
async function syncCheck(shared){
 const S={baby:{name:'test'},items:{sleep:true},gaps:{},events:[{id:'a',type:'sleep',start:1,end:null}],sample:false};
 const meta=canonical({baby:S.baby,items:S.items,gaps:S.gaps});
 const saved=shared?{fid:'AAAAAAAAAA',cursor:1_000_000,synced:{a:canonical(S.events[0])},meta}:{};
 const store=new Map([['babylog-sync-v1',JSON.stringify(saved)]]),snapshots=[],commits=[],notifications=[];
 const timers=new Map();let timerId=0;
 const app={get state(){return S},refresh(){},toast(){},applyRemote(fn){fn(S)}};
 const F={Timestamp:{fromMillis(ms){return ms}},collection(...args){return args.slice(1).join('/')},where(...args){return args},orderBy(v){return v},query(...args){return {query:args}},doc(...args){return args.slice(1).join('/')},serverTimestamp(){return 'SERVER_TIME'},onSnapshot(target,callback){snapshots.push({target,callback});return ()=>{}},writeBatch(){const writes=[];return {set(ref,data){writes.push({ref,data})},update(ref,data){writes.push({ref,data})},async commit(){commits.push(writes)}}}};
 const context={window:{BabyApp:app},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},A:{},F,auth:{currentUser:{uid:'user-test'}},db:{},crypto:globalThis.crypto,setTimeout(fn){const id=++timerId;timers.set(id,fn);return id},clearTimeout(id){timers.delete(id)},notifyFake(fid,state){notifications.push(fid)}};
 let source=fs.readFileSync(path.join(root,'sync.js'),'utf8');
 source=source.slice(source.indexOf("const LS = 'babylog-sync-v1'"));
 source=source.replaceAll("import('./push-server/web-notify.js')",'Promise.resolve({notifyFamily:notifyFake,observeFamily(){},retryPending(){}})');
 vm.runInNewContext(source,context,{timeout:1000});await tick();
 check(commits.length===0,'Startup with '+(shared?'matching sync state':'sharing off')+' performs no writes');
 check(snapshots.length===(shared?2:0),'Startup listener count '+(shared?2:0));
 for(let i=0;i<20;i++)app.refresh();await tick();
 check(commits.length===0&&notifications.length===0,'20 UI refreshes cause no commits or notifications');
 S.events.push({id:'b',type:'diaper',start:2,sub:'pee'});
 context.window.BabySync.local(S);
 for(const [id,fn]of [...timers]){timers.delete(id);fn()}await tick();
 if(shared){
  check(commits.length===1&&commits[0].length===1,'One changed event produces one document write');
  check(notifications.length===1,'One successful batch calls notify once');
  const eventListener=snapshots[0];
  eventListener.callback({metadata:{fromCache:false},docChanges(){return [{type:'added',doc:{id:'c',metadata:{hasPendingWrites:false},data(){return {id:'c',type:'diaper',start:3,sub:'poo',u:{toMillis:()=>1_000_001},by:'partner'}}}}]}});
  await tick();
  check(commits.length===1&&notifications.length===1,'Remote receipt alone does not upload or notify again');
  return {listeners:2,eventQuery:snapshots[0].target,afterSave:{batches:commits.length,documentWrites:commits[0].length,notifyCalls:notifications.length}};
 }
 check(commits.length===0&&notifications.length===0,'Local-only save makes no Firestore writes or notify calls');
 return {listeners:0,writes:0,notifications:0};
}
(async()=>{const result={baselineCommit:'efdd7a9ee919dd80931c9b284a0707ff5409d222',worker:await workerCheck(),shared:await syncCheck(true),localOnly:await syncCheck(false),checks,scope:'Current working-tree mocked paths; baselineCommit identifies the original audit only. Not production quotas, billing, or real Android tests.'};console.log(JSON.stringify(result,null,2))})().catch(e=>{console.error(e);process.exit(1)});
