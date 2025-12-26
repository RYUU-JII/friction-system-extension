import { ensureNumber } from './number.js';

export function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}시간 ${String(minutes).padStart(2, '0')}분`;
  if (minutes > 0) return `${minutes}분 ${String(seconds).padStart(2, '0')}초`;
  return `${seconds}초`;
}

export function getLocalDateStr(ts = Date.now()) {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getTodayDateStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

export function getYesterdayDateStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return getLocalDateStr(d.getTime());
}

export function isFrictionTime(schedule) {
  if (!schedule || !schedule.scheduleActive) return true;

  const now = new Date();
  const currentDay = now.getDay(); // 0 (Sun) ~ 6 (Sat)

  if (Array.isArray(schedule.days) && schedule.days.length > 0) {
    if (!schedule.days.includes(currentDay)) return false;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const isMinuteInBlock = (block) => {
    const startMin = Number.isFinite(block?.startMin) ? block.startMin : null;
    const endMin = Number.isFinite(block?.endMin) ? block.endMin : null;
    if (startMin === null || endMin === null) return false;
    if (startMin === endMin) return false;
    if (startMin > endMin) {
      return currentMinutes >= startMin || currentMinutes < endMin;
    }
    return currentMinutes >= startMin && currentMinutes < endMin;
  };

  const blocks = Array.isArray(schedule.blocks) ? schedule.blocks : [];
  if (blocks.length > 0) {
    return blocks.some((block) => isMinuteInBlock(block));
  }

  const startMin = Number.isFinite(schedule.startMin) ? schedule.startMin : 0;
  const endMin = Number.isFinite(schedule.endMin) ? schedule.endMin : 1440;

  if (startMin > endMin) {
    return currentMinutes >= startMin || currentMinutes < endMin;
  }

  return currentMinutes >= startMin && currentMinutes < endMin;
}

export function reconcileHourlyToTotal(hourly, totalMs) {
  const target = Math.max(0, ensureNumber(totalMs));
  const base = ensure24Array(hourly);
  const sum = base.reduce((acc, v) => acc + v, 0);

  if (sum === target) return base;

  if (sum <= 0) {
    return base;
  }

  const scale = target / sum;
  const scaled = base.map((v) => Math.floor(v * scale));
  const scaledSum = scaled.reduce((acc, v) => acc + v, 0);
  let rem = target - scaledSum;
  if (rem <= 0) return scaled;

  const frac = base
    .map((v, idx) => ({ idx, frac: v * scale - Math.floor(v * scale) }))
    .sort((a, b) => b.frac - a.frac);

  for (let i = 0; i < frac.length && rem > 0; i++, rem--) {
    scaled[frac[i].idx] += 1;
  }

  return scaled;
}

export function ensure24Array(val) {
  const out = Array(24).fill(0);

  if (Array.isArray(val)) {
    for (let i = 0; i < 24; i++) out[i] = Math.max(0, ensureNumber(val[i]));
    return out;
  }

  if (val && typeof val === 'object') {
    for (let i = 0; i < 24; i++) out[i] = Math.max(0, ensureNumber(val[i] ?? val[String(i)]));
    return out;
  }

  return out;
}
