const {test}=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const root=path.resolve(__dirname,'..');
function load(){const window={};const p=path.join(root,'sleep-colors.js');if(fs.existsSync(p))vm.runInNewContext(fs.readFileSync(p,'utf8'),{window,Date,Number});assert.equal(typeof window.sleepColors,'function');return window.sleepColors}
const H=3600000, MIN=60000, day=+new Date(2026,9,20), at=h=>+new Date(2026,9,20,h);
const input=()=>({day,now:at(20),ref:{totalH:[12,16],napH:[3,5],wakeMin:[75,120]},ready:true,night:10*H,nap:4*H,wake:90*MIN,wakeOpen:false});
test('19:59 keeps all default colors, 20:00 permits colors',()=>{const color=load();assert.equal(color({...input(),now:at(20)-1}).total,'');assert.equal(color(input()).total,'sleep-green');assert.equal(color(input()).nap,'sleep-green');assert.equal(color(input()).wake,'sleep-green')});
test('out of range durations are yellow, inclusive limits are green',()=>{const color=load();assert.equal(color({...input(),nap:6*H}).nap,'sleep-yellow');assert.equal(color({...input(),night:5*H}).total,'sleep-yellow');assert.equal(color({...input(),wake:121*MIN}).wake,'sleep-yellow');assert.equal(color({...input(),wake:75*MIN}).wake,'sleep-green')});
test('missing age/record coverage keeps all default colors',()=>{const color=load();for(const change of [{ref:null},{ready:false},{nap:null},{night:null}]){const c=color({...input(),...change});assert.equal(c.total,'');assert.equal(c.nap,'');assert.equal(c.wake,'')}});
test('tomorrow resets today and finished historical days keep their colors',()=>{const color=load();assert.equal(color({...input(),day:+new Date(2026,9,21),now:+new Date(2026,9,21,0)}).total,'');assert.equal(color({...input(),now:+new Date(2026,9,21,0)}).total,'sleep-green')});
test('an ongoing short wake stays purple instead of becoming a warning',()=>{const color=load();assert.equal(color({...input(),wake:10*MIN,wakeOpen:true}).wake,'');assert.equal(color({...input(),wake:130*MIN,wakeOpen:true}).wake,'sleep-yellow')});
test('no wake data and invalid numbers never turn green',()=>{const color=load();assert.equal(color({...input(),wake:null}).wake,'');assert.equal(color({...input(),wake:NaN}).wake,'');assert.equal(color({...input(),ready:false}).total,'')});
test('no evaluation labels are added by the UI integration',()=>{const html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(html,/sleep-colors\.js/);assert.match(html,/data-sleep-metric="total"/);assert.match(html,/data-sleep-metric="nap"/);assert.match(html,/data-sleep-metric="wake"/);const card=html.slice(html.indexOf('function sleepCard('),html.indexOf('// 통잠 기준'));assert.doesNotMatch(card,/정상입니다|비정상|수면 부족 경고/)});

function renderCard({gap=false,noNap=false,overlap=false,openNap=false,now=at(20)}={}) {
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
  const S={events:[{id:'night',type:'sleep',kind:'night',day,start:day-5*H,end:day+7*H},
    {id:'nap',type:'sleep',kind:'nap',day,start:day+12*H,end:openNap?null:day+16*H},
    {id:'next',type:'sleep',kind:'night',day:day+24*H,start:day+19*H,end:null}]};
  if(noNap)S.events=S.events.filter(e=>e.kind!=='nap');
  if(overlap)S.events.push({id:'overlap',type:'sleep',kind:'nap',day,start:day+13*H,end:day+14*H});
  class Clock extends Date { static now(){return now;} }
  const context={S,H,DAY:24*H,Date:Clock,window:{sleepColors:load()},
    SR:{newbornNoRhythmMonths:2},dayStart:t=>+new Date(new Date(t).setHours(0,0,0,0)),
    sleepSummary:()=>({night:12*H,nap:4*H,naps:1,nightN:1,nightMax:12*H,wakes:[90*MIN],awakeNow:null,awakeTotal:8*H,live:null}),
    sleepRef:()=>({...input().ref,months:4}),sleepKind:e=>e.kind,sleepDate:e=>e.day,
    tongjamH:()=>6,gapsOfDay:()=>gap?[{state:'missed'}]:[],durS:n=>String(n),md:()=>'',refText:()=>''};
  vm.runInNewContext(html.slice(html.indexOf('function sleepCard('),html.indexOf('// 통잠 기준')),context);
  return context.sleepCard(day);
}
test('actual card suppresses color for marked gaps, absent naps, and unfinished records',()=>{
  for(const change of [{gap:true},{noNap:true},{openNap:true}])assert.doesNotMatch(renderCard(change),/class="sleep-(green|yellow)"/);
});
test('overlapping records stay purple rather than double-counting into colors',()=>{
  assert.doesNotMatch(renderCard({overlap:true}),/class="sleep-(green|yellow)"/);
});
