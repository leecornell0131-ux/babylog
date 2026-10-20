-- 위젯 최신 요약만 저장. 원본 육아 기록/사용자 계정은 이 DB로 옮기지 않는다.
CREATE TABLE IF NOT EXISTS summaries (
  fid TEXT PRIMARY KEY,
  at INTEGER NOT NULL,
  payload TEXT NOT NULL
);
