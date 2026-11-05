// 화면 언어 (한국어·English·中文·日本語). 앱 코드는 한국어 문구 그대로 두고, 화면에 그려진 글자를 사전으로 바꿔 보여 줌.
// - 사전: i18n/<언어>.js 의 { '한국어 조각': '번역' }. 조각은 소스 문자열을 ${}·태그 기준으로 자른 것 (tools/i18n-extract.mjs)
// - 숫자(12, 3.5, 11/4, 12:30, 1h 05m, 2~3)는 '#'로 바꿔 찾고, 번역의 '#'에 차례로 되돌려 넣음 ('#2'처럼 번호를 붙이면 그 순서)
// - 한 글자 덩어리(띄어쓰기 없이 붙은 한글)는 통째로 사전에 있을 때만 바꿈 → 메모·이름 같은 사용자 글은 거의 그대로 남음
// - translate="no"가 붙은 곳(메모·아기 이름 입력 등)은 건드리지 않음
// 설정값: localStorage 'babylog-v1-lang' (이 기기에만, 가족 공유로 안 넘어감). 없으면 기기 언어로 고름
(function(){
  var LANGS=[['ko','한국어'],['en','English'],['zh','简体中文'],['ja','日本語']];
  var KEY='babylog-v1-lang';
  function detect(){
    var l=((navigator.languages&&navigator.languages[0])||navigator.language||'ko').toLowerCase();
    if(l.indexOf('ko')===0) return 'ko'; if(l.indexOf('ja')===0) return 'ja'; if(l.indexOf('zh')===0) return 'zh';
    return 'en';
  }
  var saved=null; try{ saved=localStorage.getItem(KEY) }catch(_){}
  var lang=LANGS.some(function(x){return x[0]===saved})?saved:detect();
  var dict={}, trie=null, cache=new Map(), miss=new Set();
  var KO=/[가-힣]/, KOC=/[가-힣ㄱ-ㅎㅏ-ㅣ]/;
  var NUM=/\d+(?:[.,:/~]\d+)*/g;

  function build(){ trie={}; Object.keys(dict).forEach(function(k){ var n=trie; for(var i=0;i<k.length;i++){ n=n[k[i]]||(n[k[i]]={}) } n['\u0000']=k }) }
  function fill(tr,vals){ var i=0; return tr.replace(/#(\d)?/g,function(_,d){ return d?(vals[d-1]??''):(vals[i++]??'') }) }
  // 한 줄 번역: 사전 조각으로 빈틈없이 덮는 가장 짧은 나눔을 찾음 (한글 덩어리는 중간에서 자르지 않음)
  function line(s){
    if(!KO.test(s)) return s;
    var vals=[], src=s.replace(/#/g,'\u0001').replace(NUM,function(m){ vals.push(m); return '#' });
    var n=src.length, cost=new Array(n+1).fill(Infinity), prev=new Array(n+1); cost[0]=0;
    for(var i=0;i<n;i++){ if(cost[i]===Infinity) continue;
      // 사전 조각
      var node=trie;
      for(var j=i;j<n&&node;j++){ node=node[src[j]]; if(node&&node['\u0000']&&cost[i]+1<cost[j+1]){ cost[j+1]=cost[i]+1; prev[j+1]=[i,node['\u0000']] } }
      // 그대로 두기: 한글은 덩어리째, 그 밖의 글자는 한 글자씩
      if(KOC.test(src[i])){ if(i>0&&KOC.test(src[i-1])) continue; var e=i; while(e<n&&KOC.test(src[e])) e++; if(cost[i]+1000<cost[e]){ cost[e]=cost[i]+1000; prev[e]=[i,null] } }
      else if(cost[i]+1<cost[i+1]){ cost[i+1]=cost[i]+1; prev[i+1]=[i,null] }
    }
    var parts=[], k=n, vi=vals.length, missed=false;
    while(k>0){ var p=prev[k], seg=src.slice(p[0],k), cnt=(seg.match(/#/g)||[]).length; vi-=cnt; var v=vals.slice(vi,vi+cnt);
      if(p[1]!==null) parts.push(fill(dict[p[1]],v)); else { if(KO.test(seg)) missed=true; parts.push(fill(seg,v)) } k=p[0] }
    if(missed) miss.add(src.trim());
    return parts.reverse().join('').replace(/\u0001/g,'#');
  }
  function t(s){
    if(lang==='ko'||s==null) return s; s=String(s); if(!KO.test(s)) return s.indexOf('\uE000')<0?s:s.replace(/[\uE000\uE001]/g,'');
    var c=cache.get(s); if(c!==undefined) return c;
    if(!trie) build();
    // L10N.keep()으로 감싼 부분(메모·이름 같은 사용자 글)은 번역하지 않고 표시만 지움
    var r=s.split(/(\uE000[\s\S]*?\uE001)/).map(function(part){ if(part.charAt(0)==='\uE000') return part.slice(1,-1);
      return part.split('\n').map(function(l){ var m=l.match(/^(\s*)([\s\S]*?)(\s*)$/); return m[1]+line(m[2])+m[3] }).join('\n') }).join('');
    if(cache.size>5000) cache.clear(); cache.set(s,r); return r;
  }
  // ---- 화면에 적용 ----
  var ATTRS=['placeholder','aria-label','title','alt'];
  function skip(el){ for(;el&&el.nodeType===1;el=el.parentNode){ var tn=el.nodeName; if(tn==='SCRIPT'||tn==='STYLE'||tn==='TEXTAREA') return true; if(el.getAttribute('translate')==='no') return true } return false }
  function doText(n){ var v=n.nodeValue; if(!v||!KO.test(v)||skip(n.parentNode)) return; var r=t(v); if(r!==v) n.nodeValue=r }
  function doEl(el){ if(skip(el)) return;
    for(var i=0;i<ATTRS.length;i++){ var a=el.getAttribute(ATTRS[i]); if(a&&KO.test(a)){ var r=t(a); if(r!==a) el.setAttribute(ATTRS[i],r) } }
    if(el.nodeName==='INPUT'&&(el.type==='button'||el.type==='submit')&&KO.test(el.value)) el.value=t(el.value) }
  function walk(root){
    if(root.nodeType===3) return doText(root);
    if(root.nodeType!==1&&root.nodeType!==9&&root.nodeType!==11) return;
    if(root.nodeType===1){ if(skip(root)) return; doEl(root) }
    var w=document.createTreeWalker(root,5,null), n;
    while((n=w.nextNode())){ if(n.nodeType===3) doText(n); else if(n.nodeType===1) doEl(n) }
  }
  var BabyI18n={
    lang:lang, langs:LANGS, t:t, miss:miss, walk:walk,
    keep:function(x){ return lang==='ko'||x==null||x===''?x:'\uE000'+x+'\uE001' },
    load:function(l,d){ if(l!==lang) return; for(var k in d) dict[k]=d[k]; trie=null; cache.clear() },
    set:function(l){ try{ localStorage.setItem(KEY,l) }catch(_){} },
    saved:function(){ try{ return localStorage.getItem(KEY) }catch(_){ return null } },
    // 요일 한 글자 / 긴 이름 (일=0)
    dow:function(i){ return ({ko:'일월화수목금토',en:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'],zh:'日一二三四五六',ja:'日月火水木金土'})[lang][i] },
    dowLong:function(i){ var d=BabyI18n.dow(i); return lang==='ko'?d+'요일':lang==='en'?['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i]:lang==='zh'?'星期'+d:d+'曜日' },
    // "11월 4일 화요일" 같은 날짜 머리글
    dateLong:function(t){ var d=new Date(t), m=d.getMonth()+1, dd=d.getDate(), w=d.getDay();
      if(lang==='en') return BabyI18n.dow(w)+', '+['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m-1]+' '+dd;
      if(lang==='zh') return m+'月'+dd+'日 '+BabyI18n.dowLong(w);
      if(lang==='ja') return m+'月'+dd+'日 '+BabyI18n.dowLong(w);
      return m+'월 '+dd+'일 '+BabyI18n.dowLong(w) }
  };
  window.BabyI18n=BabyI18n;
  if(lang==='ko') return;
  document.documentElement.lang=lang==='zh'?'zh-CN':lang;
  // 사전 파일은 고른 언어 것만 (페이지를 읽는 중이라 바로 이어서 실행됨)
  var me=document.currentScript, base=me&&me.src?me.src.replace(/i18n\.js(\?.*)?$/,''):'';
  document.write('<script src="'+base+'i18n/'+lang+'.js"><\/script>');
  var mo=new MutationObserver(function(list){
    for(var i=0;i<list.length;i++){ var m=list[i];
      if(m.type==='childList') for(var j=0;j<m.addedNodes.length;j++) walk(m.addedNodes[j]);
      else if(m.type==='characterData') doText(m.target);
      else if(m.type==='attributes') doEl(m.target) }
  });
  mo.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:ATTRS});
})();
