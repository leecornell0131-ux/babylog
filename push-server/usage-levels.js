// 사용량 경보 단계와 수용 인원 계산. 대시보드(usage.html)와 매일 점검(.github/workflows/usage-check.yml)이 같이 씀.
// 대응 방법은 프로젝트 파일 guide/사용량_넘칠때_대응.md에 단계별로 있음.
export const LEVELS = [
  { min: 0, key: 'ok', name: '여유', act: '할 일 없음.' },
  { min: 50, key: 'watch', name: '지켜보기', act: '홍보 속도를 조금 늦추고 많이 쓰는 가족이 있는지 표에서 확인.' },
  { min: 70, key: 'prepare', name: '준비', act: '읽기 줄이기 작업을 시작하고, Firebase 종량제(카드 등록) 전환을 결정.' },
  { min: 85, key: 'act', name: '바로 대응', act: '오늘 안에 종량제 전환 또는 새 가족 공유 잠시 막기. 넘치면 그날은 동기화가 멈춤(기록은 휴대폰에 남음).' },
];
export const level = pct => LEVELS.reduce((r, l) => (pct >= l.min ? l : r), LEVELS[0]);

// 하루 사용량의 한도 대비 %. Firestore 읽기·쓰기는 휴대폰이 센 대략값이라 10% 여유를 더해 봄.
export const FS_MARGIN = 1.1;
export function percents(d, limits) {
  return {
    reads: d.reads * FS_MARGIN / limits.fsReads * 100,
    writes: d.writes * FS_MARGIN / limits.fsWrites * 100,
    req: d.req / limits.cfRequests * 100,
  };
}
export const worst = p => Math.max(p.reads, p.writes, p.req);

// 실제 쓰는 가족들의 평균으로 "몇 가족까지 받을 수 있나"를 계산. 공유를 안 쓰는 사람은 Firebase·알림 서버를 거의 안 씀.
export function capacity(d, limits) {
  const n = d.sharedFamilies || d.families;
  if (!n) return null;
  const per = { reads: d.reads * FS_MARGIN / n, writes: d.writes * FS_MARGIN / n, req: d.req / n };
  const caps = [
    { what: 'Firebase 읽기', n: per.reads ? Math.floor(limits.fsReads / per.reads) : Infinity },
    { what: 'Firebase 쓰기', n: per.writes ? Math.floor(limits.fsWrites / per.writes) : Infinity },
    { what: '알림 서버 요청', n: per.req ? Math.floor(limits.cfRequests / per.req) : Infinity },
  ].sort((a, b) => a.n - b.n);
  return { families: n, per, max: caps[0].n, safe: Math.floor(caps[0].n * 0.8), bottleneck: caps[0].what, caps };
}
