-- 서비스 전체의 하루 합계(가족코드 없음). 가족별 줄(usage_req·usage_app)은 60일 뒤 지우지만 이 표는 계속 보관해
-- 수용 인원·수익 분석에 씀. 매시간 usage-check가 마감된 날의 최종 값을 넣음.
CREATE TABLE IF NOT EXISTS usage_daily (
  day TEXT PRIMARY KEY,
  req INTEGER, reads INTEGER, writes INTEGER,
  families INTEGER, shared INTEGER,
  src TEXT,
  at INTEGER NOT NULL
) WITHOUT ROWID;
