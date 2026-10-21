const {test}=require('node:test'), assert=require('node:assert/strict'), path=require('node:path');
const I=require(path.join(__dirname,'..','import-format.js'));
const at=(d,h,m=0)=>+new Date(2026,9,d,h,m), now=at(21,23);
const sample={format:'babylog-import',v:1,source:'베이비타임',baby:{birth:'2026-06-26',sex:'여'},records:[
  {time:'2026-10-20 14:30',kind:'분유',amount:120,tags:['게움','없는태그']},
  {time:'2026-10-20 23:10',end:'2026-10-21 03:40',kind:'수면'},
  {time:'2026-10-21 07:05',kind:'대변',tags:['묽은 변'],note:'양 많음'},
  {time:'2026-10-21 08:00',kind:'모유',amount:'12분'},
  {time:'2026-10-21 09:00',kind:'성장',kg:5.8,cm:60},
  {time:'2026-10-21 10:00',kind:'체온',amount:37.6}]};
test('converts every kind to the stored event shape',()=>{
  const r=I.convert(sample,{now});
  assert.equal(r.events.length,6); assert.equal(r.skipped.length,0); assert.equal(r.source,'베이비타임');
  const [f,s,p,b,g,t]=r.events;
  assert.deepEqual([f.type,f.sub,f.ml,f.start,f.tags],['feed','formula',120,at(20,14,30),['spit']]);
  assert.deepEqual([s.type,s.start,s.end],['sleep',at(20,23,10),at(21,3,40)]);
  assert.deepEqual([p.type,p.sub,p.tags,p.note],['diaper','poo',['loose'],'양 많음']);
  assert.deepEqual([b.sub,b.min],['breastL',12]);
  assert.deepEqual([g.type,g.kg,g.cm],['growth',5.8,60]);
  assert.deepEqual([t.type,t.sub,t.val],['etc','temp',37.6]);
  r.events.forEach(e=>{assert.match(e.id,/^imp-/);assert.equal(e.src,'import');assert.equal(e.from,'베이비타임')});
  assert.deepEqual(r.baby,{birth:'2026-06-26',sex:'f'});
});
test('importing the same answer twice adds nothing',()=>{
  const first=I.convert(sample,{now}).events, again=I.convert(sample,{now,existing:first});
  assert.equal(again.events.length,0); assert.equal(again.skipped.length,6);
});
test('records already logged in our app within 2 minutes are skipped',()=>{
  const r=I.convert(sample,{now,existing:[{id:'x',type:'feed',sub:'formula',start:at(20,14,31)}]});
  assert.equal(r.events.length,5); assert.equal(r.skipped[0].reason,'이미 비슷한 기록 있음');
});
test('bad rows are skipped with a reason, odd amounts are dropped with a warning',()=>{
  const r=I.convert({records:[{time:'10/21 14:30',kind:'분유'},{time:'2026-10-21 14:30',kind:'춤추기'},
    {time:'2026-10-21 14:30',kind:'수면'},{time:'2026-10-21 14:30',end:'2026-10-21 14:00',kind:'수면'},
    {time:'2026-12-01 10:00',kind:'소변'},{time:'2026-02-30 10:00',kind:'소변'},{time:'2026-10-21 11:00',kind:'분유',amount:900}]},{now});
  assert.deepEqual(r.skipped.map(s=>s.reason.replace(/:.*/,'')),['시각을 읽지 못함','모르는 항목','수면 끝 시각 없음','수면 끝이 시작보다 빠름','미래 시각','시각을 읽지 못함']);
  assert.equal(r.events.length,1); assert.equal(r.events[0].ml,undefined); assert.equal(r.warned.length,1);
});
test('extracts JSON from an AI answer with code fences and a trailing note',()=>{
  const j=I.extractJSON('여기 있어요\n```json\n'+JSON.stringify(sample)+'\n```\n바꾸지 못한 기록 0개');
  assert.ok(I.isImport(j)); assert.equal(j.records.length,6);
  assert.ok(!I.isImport({app:'babylog',v:2,state:{events:[]}}));
});
test('prompt lists every kind and the time rule',()=>{
  const p=I.prompt(); Object.keys(I.KINDS).forEach(k=>assert.ok(p.includes('- '+k),k)); assert.match(p,/YYYY-MM-DD HH:MM/);
});
