// 다른 육아 앱 기록 가져오기: 사용자의 AI(ChatGPT·Claude 등)가 다른 앱의 내보내기 파일을
// 아래 "가져오기 양식"으로 바꾸고, 앱이 그것을 저장 양식(babylog-v1 이벤트)으로 옮긴다.
// 저장 양식은 그대로 두고 이 파일 안에서만 변환하므로 갤럭시 앱(bridge.js)·서버와 호환된다.
(function (root) {
  const MIN = 60000, H = 60 * MIN, DAY = 24 * H;
  // 가져오기 양식의 kind 이름 → 저장 양식. amount 단위는 unit (없으면 양을 받지 않음)
  const KINDS = {
    '분유': { type: 'feed', sub: 'formula', key: 'ml', unit: 'ml', max: 400 },
    '모유 왼쪽': { type: 'feed', sub: 'breastL', key: 'min', unit: '분', max: 120 },
    '모유 오른쪽': { type: 'feed', sub: 'breastR', key: 'min', unit: '분', max: 120 },
    '유축 수유': { type: 'feed', sub: 'pump', key: 'ml', unit: 'ml', max: 400 },
    '수면': { type: 'sleep' },
    '소변': { type: 'diaper', sub: 'pee' },
    '대변': { type: 'diaper', sub: 'poo' },
    '소변+대변': { type: 'diaper', sub: 'both' },
    '성장': { type: 'growth' },
    '이유식': { type: 'etc', sub: 'solid', key: 'val', unit: 'g', max: 1000 },
    '간식': { type: 'etc', sub: 'snack', key: 'val', unit: 'g', max: 1000 },
    '물·음료': { type: 'etc', sub: 'water', key: 'val', unit: 'ml', max: 1000 },
    '유축하기': { type: 'etc', sub: 'pumping', key: 'val', unit: 'ml', max: 1000 },
    '목욕': { type: 'etc', sub: 'bath' },
    '산책': { type: 'etc', sub: 'walk', key: 'val', unit: '분', max: 600 },
    '터미타임': { type: 'etc', sub: 'tummy', key: 'val', unit: '분', max: 240 },
    '체온': { type: 'etc', sub: 'temp', key: 'val', unit: '℃', min: 30, max: 45 },
    '약': { type: 'etc', sub: 'med' },
    '토함': { type: 'etc', sub: 'vomit' },
    '기침·콧물': { type: 'etc', sub: 'cough' },
    '발진·피부': { type: 'etc', sub: 'rash' },
    '병원': { type: 'etc', sub: 'hospital' },
    '예방접종': { type: 'etc', sub: 'vaccine' },
    '메모': { type: 'etc', sub: 'memo' },
  };
  // AI가 조금 다르게 적어도 받아 주는 별칭
  const ALIAS = { '모유': '모유 왼쪽', '모유(왼쪽)': '모유 왼쪽', '모유(오른쪽)': '모유 오른쪽', '유축': '유축 수유', '유축수유': '유축 수유',
    '잠': '수면', '낮잠': '수면', '밤잠': '수면', '기저귀 소변': '소변', '기저귀 대변': '대변', '소변 대변': '소변+대변', '소변+대변 둘 다': '소변+대변', '둘 다': '소변+대변',
    '키·몸무게': '성장', '몸무게': '성장', '키': '성장', '물': '물·음료', '음료': '물·음료', '기침': '기침·콧물', '콧물': '기침·콧물', '발진': '발진·피부' };
  // 특이사항 태그 (index.html TAGS와 같은 코드)
  const TAGS = {
    feed: { '게움': 'spit', '토함': 'vomit', '남김': 'left', '거부': 'refuse', '보챔': 'fuss', '먹다 잠듦': 'asleep' },
    poo: { '묽은 변': 'loose', '단단한 변': 'hard', '시큼한 냄새': 'sour', '초록색': 'green', '점액·거품': 'mucus', '피 섞임': 'blood', '흰색·회색': 'pale' } };

  // "2026-10-21 14:30" (이 휴대폰 시간대의 현지 시각) → ms. 초·T·/·. 구분도 받음
  function parseTime(s) {
    if (typeof s !== 'string') return null;
    const m = s.trim().match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!m) return null;
    const [y, mo, d, h, mi] = m.slice(1, 6).map(Number);
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
    const t = new Date(y, mo - 1, d, h, mi).getTime();
    return new Date(t).getDate() === d ? t : null;
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  const num = v => { const n = typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : v; return typeof n === 'number' && isFinite(n) && n > 0 ? n : null; };

  // AI 답에는 ```json 이나 설명 글이 붙기도 하므로 { } 부분만 꺼냄
  function extractJSON(text) {
    const t = String(text || '').replace(/```(?:json)?/gi, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('양식을 찾지 못했어요');
    return JSON.parse(t.slice(a, b + 1));
  }

  // 가져오기 양식 → { events, skipped:[{n, reason}], warned:[...], baby, source }
  // opts: { existing: 지금 기록 배열, now, birth: 'YYYY-MM-DD' }
  function convert(j, opts = {}) {
    const recs = Array.isArray(j) ? j : j && Array.isArray(j.records) ? j.records : null;
    if (!recs) throw new Error('records 목록이 없어요');
    const now = opts.now || Date.now(), source = (j && typeof j.source === 'string' ? j.source : '').slice(0, 30);
    const birth = (opts.birth || (j.baby && j.baby.birth) || '').match(/^\d{4}-\d{2}-\d{2}$/) ? new Date((opts.birth || j.baby.birth) + 'T00:00:00').getTime() : null;
    const seen = new Set((opts.existing || []).map(e => e.id));
    // 이미 기록한 것과 같은 종류가 2분 안에 있으면 같은 기록으로 봄 (두 앱에 같이 기록한 날)
    const near = {}; (opts.existing || []).forEach(e => { const k = e.type + '|' + (e.sub || ''); (near[k] = near[k] || []).push(e.start); });
    const events = [], skipped = [], warned = [];
    const skip = (n, reason) => skipped.push({ n, reason });
    recs.forEach((r, i) => {
      const n = i + 1;
      if (!r || typeof r !== 'object') return skip(n, '읽을 수 없는 줄');
      let kind = String(r.kind || '').trim(); kind = KINDS[kind] ? kind : ALIAS[kind] || ALIAS[kind.replace(/\s/g, '')] || kind;
      const k = KINDS[kind]; if (!k) return skip(n, '모르는 항목: ' + (r.kind || '(없음)'));
      const start = parseTime(r.time); if (start == null) return skip(n, '시각을 읽지 못함: ' + (r.time || '(없음)'));
      if (start > now + 5 * MIN) return skip(n, '미래 시각');
      if (birth && start < birth - DAY) return skip(n, '태어나기 전 시각');
      const e = { type: k.type, start };
      if (k.sub) e.sub = k.sub;
      if (k.type === 'sleep') {
        const end = parseTime(r.end);
        if (end == null) return skip(n, '수면 끝 시각 없음');
        if (end <= start) return skip(n, '수면 끝이 시작보다 빠름');
        if (end - start > 20 * H) return skip(n, '수면이 20시간 넘음');
        e.end = end;
        if (/밤잠/.test(String(r.kind) + (r.sleep || ''))) e.kind = 'night'; else if (/낮잠/.test(String(r.kind) + (r.sleep || ''))) e.kind = 'nap';
      }
      if (k.key) {
        const a = num(r.amount);
        if (a != null) {
          if (a > k.max || (k.min && a < k.min)) warned.push(n + '번째 ' + kind + ' 양 ' + a + k.unit + '는 확인이 필요해 보여서 양을 비웠어요');
          else e[k.key] = Math.round(a * 10) / 10;
        }
      }
      if (k.type === 'growth') {
        ['kg', 'cm', 'head'].forEach(f => { const v = num(r[f]); if (v != null) e[f] = Math.round(v * 100) / 100; });
        if (e.kg > 30) delete e.kg;
        if (!e.kg && !e.cm && !e.head) return skip(n, '성장 기록에 숫자 없음');
      }
      const tg = e.type === 'feed' ? TAGS.feed : e.type === 'diaper' && e.sub !== 'pee' ? TAGS.poo : null;
      if (tg && Array.isArray(r.tags)) { const t = [...new Set(r.tags.map(x => tg[String(x).trim()]).filter(Boolean))]; if (t.length) e.tags = t; }
      const note = typeof r.note === 'string' ? r.note.trim().slice(0, 200) : '';
      if (note) e.note = note;
      e.id = 'imp-' + hash([e.type, e.sub || '', e.start, e.end || '', e.ml || e.min || e.val || e.kg || ''].join('|'));
      if (seen.has(e.id)) return skip(n, '이미 있는 기록');
      const nk = e.type + '|' + (e.sub || '');
      if (e.type !== 'growth' && (near[nk] || []).some(t => Math.abs(t - start) <= 2 * MIN)) return skip(n, '이미 비슷한 기록 있음');
      seen.add(e.id); (near[nk] = near[nk] || []).push(start);
      e.src = 'import'; if (source) e.from = source;
      if (r.approx === true) e.approx = true;
      events.push(e);
    });
    let baby = null;
    if (j && j.baby && typeof j.baby === 'object') {
      const b = j.baby; baby = {};
      if (/^\d{4}-\d{2}-\d{2}$/.test(b.birth || '')) baby.birth = b.birth;
      if (b.sex === '남' || b.sex === 'M' || b.sex === 'male') baby.sex = 'm'; else if (b.sex === '여' || b.sex === 'F' || b.sex === 'female') baby.sex = 'f';
      if (num(b.birthKg) && b.birthKg < 7) baby.birthKg = num(b.birthKg);
    }
    return { events, skipped, warned, baby, source, approx: events.filter(e => e.approx).length };
  }

  function prompt() {
    const amt = Object.entries(KINDS).map(([n, k]) => '- ' + n + (k.unit ? ' (amount = ' + k.unit + ')' : k.type === 'sleep' ? ' (time = 잠든 시각, end = 깬 시각 필수)' : k.type === 'growth' ? ' (kg, cm, head 중 아는 것)' : '')).join('\n');
    return `아래에 붙인 육아 앱 기록(내보내기 파일·PDF·표·캡처)을 "아기로그 가져오기 양식" JSON으로 바꿔 주세요.

[양식]
{"format":"babylog-import","v":1,"source":"원래 앱 이름","baby":{"birth":"YYYY-MM-DD","sex":"남 또는 여","birthKg":3.1},
"records":[
{"time":"2026-10-21 14:30","kind":"분유","amount":120},
{"time":"2026-10-21 15:10","end":"2026-10-21 16:40","kind":"수면"},
{"time":"2026-10-21 17:00","kind":"대변","tags":["묽은 변"],"note":"원래 앱의 메모"}
]}

[kind는 아래 이름 중 하나만]
${amt}

[규칙]
1. time·end는 원래 앱에 적힌 시각 그대로 "YYYY-MM-DD HH:MM" (24시간제). 시간대를 바꾸지 마세요. 날짜가 머리글에만 있으면 각 줄에 날짜를 붙이고, 자정을 넘긴 수면은 end에 다음 날 날짜를 쓰세요.
2. 모유를 양쪽 다 먹였으면 "모유 왼쪽"과 "모유 오른쪽" 두 줄로 나누고 amount에 각각 분을 쓰세요. 어느 쪽인지 모르면 "모유 왼쪽"으로 하고 note에 "쪽 모름"이라고 쓰세요.
3. 기저귀에 소변·대변이 같이 있으면 "소변+대변" 한 줄로 쓰세요.
4. tags는 아는 경우만. 수유: 게움, 토함, 남김, 거부, 보챔, 먹다 잠듦 / 대변: 묽은 변, 단단한 변, 시큼한 냄새, 초록색, 점액·거품, 피 섞임, 흰색·회색. 이 외의 상태나 위 목록에 없는 기록 종류는 "메모" 또는 note에 원문 그대로 쓰세요.
5. 숫자를 지어내지 마세요. 모르는 값은 빼고, 원래 기록에 없는 줄을 만들지 마세요. 아기 이름은 넣지 마세요.
5-1. 원래 파일이 그래프 리포트라 시각이 글자로 없고 점·막대 위치로만 보이면(예: 삐요로그 PDF), 거절하지 말고 그 점이 있는 칸의 가운데 시각을 쓰고 그 줄에 "approx":true를 붙이세요 (예: 한 칸이 1시간이고 14시 칸에 점이 있으면 "14:30"). 양(ml)이 날마다 아래에서 위로 쌓인 막대로만 있으면 아래쪽부터 그날 시각 순서로 짝지으세요. 시각을 위치로도 알 수 없는 기록(하루 합계·횟수만 있는 것)은 빼고, 마지막 한 줄에 무엇을 뺐는지 알려 주세요.
6. 답에는 JSON만, records는 한 줄에 기록 하나씩 쓰세요.
7. 기록이 300개가 넘으면 코드 실행으로 babylog-import.json 파일을 만들어 내려받게 해 주세요. 그게 안 되면 한 달씩 나눠서 차례로 답해 주세요 (각 답이 모두 위 양식의 완전한 JSON이어야 해요).
8. 마지막에 JSON 밖에 한 줄로, 바꾸지 못한 기록이 있으면 몇 개이고 왜인지 알려 주세요.`;
  }

  const api = { KINDS, parseTime, extractJSON, convert, prompt, isImport: j => !!j && (j.format === 'babylog-import' || (Array.isArray(j.records) && !j.state && !j.events)) };
  root.BabyImport = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
