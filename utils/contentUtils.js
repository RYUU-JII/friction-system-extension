// utils/contentUtils.js
// Content scripts in MV3 are NOT ES modules, so helpers must be provided as classic scripts.

function isFrictionTime(schedule) {
  if (!schedule || !schedule.scheduleActive) return true;

  const now = new Date();
  const currentDay = now.getDay(); // 0(일) ~ 6(토)

  if (Array.isArray(schedule.days) && schedule.days.length > 0) {
    if (!schedule.days.includes(currentDay)) return false;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const { startMin, endMin } = schedule;

  if (startMin > endMin) {
    return currentMinutes >= startMin || currentMinutes < endMin;
  }
  return currentMinutes >= startMin && currentMinutes < endMin;
}

function getHostname(url) {
  try {
    const u = new URL(url);
    return u.hostname ? u.hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
}

