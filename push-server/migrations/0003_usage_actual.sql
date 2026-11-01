-- Cloudflare·Firebase가 직접 센 하루 합계 (UTC 날짜). 매시간 GitHub Actions(usage-check)가 채움.
-- 대시보드는 이 값을 우선 쓰고, 휴대폰·서버가 센 값은 가족별 비중과 아직 집계 전인 시간만 보충.
CREATE TABLE IF NOT EXISTS usage_actual (
  day TEXT PRIMARY KEY,
  cf_req INTEGER,
  fs_reads INTEGER,
  fs_writes INTEGER,
  at INTEGER NOT NULL
) WITHOUT ROWID;
