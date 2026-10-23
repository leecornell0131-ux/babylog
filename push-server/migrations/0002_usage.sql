-- 가족별 하루 사용량 (숫자만). 하루 = UTC 날짜 = 한국 시각 아침 9시~다음 날 아침 9시 (Cloudflare 무료 한도 초기화 기준).
-- usage_req: 이 서버가 받은 요청 수(가족코드 없는 요청은 fid '-'로 모음)
-- WITHOUT ROWID: 저장 1번 = D1 쓰기 1행 (일반 표는 기본키 색인까지 2행으로 셈)
-- usage_app: 각 휴대폰이 스스로 센 Firestore 읽기·쓰기 횟수(대략값). dev = 휴대폰마다 만든 무작위 번호
CREATE TABLE IF NOT EXISTS usage_req (
  day TEXT NOT NULL,
  fid TEXT NOT NULL,
  req INTEGER NOT NULL,
  PRIMARY KEY (day, fid)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS usage_app (
  day TEXT NOT NULL,
  fid TEXT NOT NULL,
  dev TEXT NOT NULL,
  reads INTEGER NOT NULL,
  writes INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (day, fid, dev)
) WITHOUT ROWID;
