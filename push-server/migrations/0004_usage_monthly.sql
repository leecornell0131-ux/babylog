-- 달마다 정해진 무료 한도 (Codemagic 빌드 시간 등). month = 'YYYY-MM' (UTC). usage-check가 매시간 채움.
CREATE TABLE IF NOT EXISTS usage_monthly (
  month TEXT NOT NULL,
  kind TEXT NOT NULL,
  used REAL NOT NULL,
  count INTEGER,
  at INTEGER NOT NULL,
  PRIMARY KEY (month, kind)
) WITHOUT ROWID;
