-- Cloudflare 직접 집계를 저장한 그 순간의 서버 자체 집계(요청 수). 오늘 숫자 = 직접 집계 + 그 뒤로 서버가 더 센 만큼.
ALTER TABLE usage_actual ADD COLUMN est_req INTEGER;
