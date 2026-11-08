-- 베타 테스터(얼리버드 코드를 넣은 휴대폰) 번호별 하루 사용량. 숫자만, 60일 뒤 삭제.
-- tc = 테스터 번호(1~99, 누구인지는 운영자만 아는 코드표로 연결), dev = 휴대폰마다 만든 무작위 번호,
-- fam = 가족 공유 중이면 가족코드 앞 2자리(아니면 ''), ev = 그날 이 휴대폰에서 남긴 기록 개수
CREATE TABLE IF NOT EXISTS usage_tester (
  day TEXT NOT NULL,
  tc INTEGER NOT NULL,
  dev TEXT NOT NULL,
  fam TEXT NOT NULL,
  ev INTEGER NOT NULL,
  reads INTEGER NOT NULL,
  writes INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (day, tc, dev)
) WITHOUT ROWID;
