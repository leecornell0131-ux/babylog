// 표시 전용. 저장/동기화/알림 없이 기기의 현지 날짜와 시각으로 계산한다.
window.sleepColors = function ({ day, now, ref, ready, night, nap, wake, wakeOpen }) {
  const plain = { total: '', nap: '', wake: '' };
  const cutoff = new Date(day); cutoff.setHours(20, 0, 0, 0);
  if (now < +cutoff || !ref || !ready || !Number.isFinite(night) || !Number.isFinite(nap)) return plain;
  const color = (value, range, ongoing = false) => {
    if (!Number.isFinite(value) || value < 0 || !Array.isArray(range) || range.length !== 2 ||
        !range.every(Number.isFinite) || range[0] > range[1]) return '';
    if (ongoing && value < range[0]) return '';
    return value >= range[0] && value <= range[1] ? 'sleep-green' : 'sleep-yellow';
  };
  return {
    total: color((night + nap) / 3600000, ref.totalH),
    nap: color(nap / 3600000, ref.napH),
    wake: color(wake == null ? null : wake / 60000, ref.wakeMin, wakeOpen),
  };
};
