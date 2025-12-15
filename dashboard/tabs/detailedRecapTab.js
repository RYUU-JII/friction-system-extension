import { getDailyData, getWeeklyData } from '../../dataManager.js';
import { formatTime, getTodayDateStr } from '../../utils/utils.js';

function formatBlockedInsight(blockedMs, totalMs) {
  if (!totalMs || totalMs <= 0) return '기록된 사용 시간이 없어요.';
  const pct = Math.round((blockedMs / totalMs) * 100);
  if (pct <= 0) return '차단된 사이트 사용이 없어요.';
  return `차단된 사이트에서 전체의 ${pct}%를 사용했어요.`;
}

function findPeakBlockedRatio(totalSeries, blockedSeries, labels, minTotalMs = 60_000) {
  let bestIdx = null;
  let bestPct = 0;

  for (let i = 0; i < totalSeries.length; i++) {
    const total = totalSeries[i] || 0;
    const blocked = blockedSeries[i] || 0;
    if (total < minTotalMs || blocked <= 0) continue;

    const pct = (blocked / total) * 100;
    if (pct > bestPct) {
      bestPct = pct;
      bestIdx = i;
    }
  }

  if (bestIdx === null) return null;
  return { label: labels[bestIdx], pct: Math.round(bestPct) };
}

function ensureChartTooltip() {
  let el = document.getElementById('chartTooltip');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'chartTooltip';
  el.className = 'chart-tooltip';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  document.body.appendChild(el);
  return el;
}

function positionTooltip(el, clientX, clientY) {
  const offset = 12;
  const maxWidth = 280;
  el.style.maxWidth = `${maxWidth}px`;

  el.style.left = `0px`;
  el.style.top = `0px`;
  el.classList.add('is-visible');

  const rect = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = clientX + offset;
  let top = clientY + offset;

  if (left + rect.width > vw - 8) left = clientX - rect.width - offset;
  if (top + rect.height > vh - 8) top = clientY - rect.height - offset;

  left = Math.max(8, Math.min(vw - rect.width - 8, left));
  top = Math.max(8, Math.min(vh - rect.height - 8, top));

  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

function hideTooltip(el) {
  el.classList.remove('is-visible');
}

function bindChartTooltip(container) {
  if (!container) return;
  const tooltipEl = ensureChartTooltip();

  container.addEventListener('mousemove', (e) => {
    const bar = e.target instanceof Element ? e.target.closest('.bar-stack') : null;
    if (!bar || !container.contains(bar)) {
      hideTooltip(tooltipEl);
      return;
    }
    const text = bar.dataset.tooltip || '';
    if (!text) {
      hideTooltip(tooltipEl);
      return;
    }
    tooltipEl.textContent = text;
    positionTooltip(tooltipEl, e.clientX, e.clientY);
  });

  container.addEventListener('mouseleave', () => hideTooltip(tooltipEl));
}

export function createDetailedRecapTab({ UI, getState }) {
  let mode = 'daily';

  function setMode(nextMode) {
    mode = nextMode === 'weekly' ? 'weekly' : 'daily';
    if (UI.toggleDaily && UI.toggleWeekly) {
      UI.toggleDaily.classList.toggle('active', mode === 'daily');
      UI.toggleWeekly.classList.toggle('active', mode === 'weekly');
    }
    display();
  }

  function display() {
    const dailyEl = document.getElementById('dailyAnalysis');
    const weeklyEl = document.getElementById('weeklyAnalysis');
    if (dailyEl && weeklyEl) {
      dailyEl.classList.toggle('active', mode === 'daily');
      weeklyEl.classList.toggle('active', mode === 'weekly');
    }

    if (mode === 'daily') {
      const selectedDate = UI.dailyDate?.value || getTodayDateStr();
      renderDailyGraph(selectedDate);
    } else {
      renderWeeklyGraph();
    }
  }

  function renderDailyGraph(dateStr) {
    const { currentStats, currentBlockedUrls } = getState();
    const { hourly, hourlyBlocked, total, blocked, change } = getDailyData(currentStats, dateStr, currentBlockedUrls);

    if (UI.dailyTotal) UI.dailyTotal.textContent = formatTime(total);
    if (UI.dailyBlocked) UI.dailyBlocked.textContent = formatTime(blocked);
    if (UI.dailyChange) {
      UI.dailyChange.textContent = change.startsWith('-') ? change : `+${change}`;
      UI.dailyChange.style.color = change.startsWith('-') ? 'var(--color-safe)' : 'var(--color-blocked)';
    }

    if (UI.dailyGraph) UI.dailyGraph.innerHTML = '';
    const maxHour = Math.max(...hourly, 1);
    const peak = findPeakBlockedRatio(hourly, hourlyBlocked, Array.from({ length: 24 }, (_, i) => `${i}시`));
    if (UI.dailyInsight) {
      const base = formatBlockedInsight(blocked, total);
      UI.dailyInsight.textContent = peak ? `${base} · 최고 ${peak.label} (${peak.pct}%)` : base;
    }

    hourly.forEach((time, h) => {
      const height = (time / maxHour) * 100;
      const blockedTime = hourlyBlocked[h] || 0;
      const safeTime = Math.max(0, time - blockedTime);
      const blockedPct = time > 0 ? (blockedTime / time) * 100 : 0;
      const safePct = time > 0 ? (safeTime / time) * 100 : 0;
      const tooltip = `${h}시\n총 ${formatTime(time)}\n차단 ${formatTime(blockedTime)} (${Math.round(blockedPct)}%)`;

      const barWrapper = document.createElement('div');
      barWrapper.className = 'bar-wrapper';

      const barStack = document.createElement('div');
      barStack.className = 'bar-stack';
      barStack.style.height = `${height}%`;
      barStack.dataset.tooltip = tooltip;

      const safeSeg = document.createElement('div');
      safeSeg.className = 'bar-segment bar-safe';
      safeSeg.style.height = `${safePct}%`;

      const blockedSeg = document.createElement('div');
      blockedSeg.className = 'bar-segment bar-blocked';
      blockedSeg.style.height = `${blockedPct}%`;

      barStack.appendChild(blockedSeg);
      barStack.appendChild(safeSeg);
      barWrapper.appendChild(barStack);

      if (h % 3 === 0) {
        const label = document.createElement('div');
        label.className = 'bar-label';
        label.textContent = String(h);
        barWrapper.appendChild(label);
      }

      UI.dailyGraph?.appendChild(barWrapper);
    });
  }

  function renderWeeklyGraph() {
    const { currentStats, currentBlockedUrls } = getState();
    const { weekdayData, weekdayBlocked, total, blocked, change } = getWeeklyData(currentStats, currentBlockedUrls);

    if (UI.weeklyTotal) UI.weeklyTotal.textContent = formatTime(total);
    if (UI.weeklyBlocked) UI.weeklyBlocked.textContent = formatTime(blocked);
    if (UI.weeklyChange) {
      UI.weeklyChange.textContent = change.startsWith('-') ? change : `+${change}`;
      UI.weeklyChange.style.color = change.startsWith('-') ? 'var(--color-safe)' : 'var(--color-blocked)';
    }

    if (UI.weeklyGraph) UI.weeklyGraph.innerHTML = '';
    const maxDay = Math.max(...weekdayData, 1);
    const days = ['일', '월', '화', '수', '목', '금', '토'];
    const peak = findPeakBlockedRatio(weekdayData, weekdayBlocked, days);
    if (UI.weeklyInsight) {
      const base = formatBlockedInsight(blocked, total);
      UI.weeklyInsight.textContent = peak ? `${base} · 최고 ${peak.label} (${peak.pct}%)` : base;
    }

    weekdayData.forEach((time, idx) => {
      const height = (time / maxDay) * 100;
      const blockedTime = weekdayBlocked[idx] || 0;
      const safeTime = Math.max(0, time - blockedTime);
      const blockedPct = time > 0 ? (blockedTime / time) * 100 : 0;
      const safePct = time > 0 ? (safeTime / time) * 100 : 0;
      const tooltip = `${days[idx]}\n총 ${formatTime(time)}\n차단 ${formatTime(blockedTime)} (${Math.round(blockedPct)}%)`;

      const barWrapper = document.createElement('div');
      barWrapper.className = 'bar-wrapper';
      barWrapper.style.width = '14%';

      const barStack = document.createElement('div');
      barStack.className = 'bar-stack';
      barStack.style.height = `${height}%`;
      barStack.dataset.tooltip = tooltip;

      const safeSeg = document.createElement('div');
      safeSeg.className = 'bar-segment bar-safe';
      safeSeg.style.height = `${safePct}%`;

      const blockedSeg = document.createElement('div');
      blockedSeg.className = 'bar-segment bar-blocked';
      blockedSeg.style.height = `${blockedPct}%`;

      barStack.appendChild(blockedSeg);
      barStack.appendChild(safeSeg);
      barWrapper.appendChild(barStack);

      const label = document.createElement('div');
      label.className = 'bar-label';
      label.textContent = days[idx];
      barWrapper.appendChild(label);

      UI.weeklyGraph?.appendChild(barWrapper);
    });
  }

  function setup() {
    if (UI.dailyDate) {
      const today = getTodayDateStr();
      UI.dailyDate.value = today;
      UI.dailyDate.max = today;
      UI.dailyDate.addEventListener('change', () => display());
    }

    if (UI.toggleDaily) UI.toggleDaily.addEventListener('click', () => setMode('daily'));
    if (UI.toggleWeekly) UI.toggleWeekly.addEventListener('click', () => setMode('weekly'));

    bindChartTooltip(UI.dailyGraph);
    bindChartTooltip(UI.weeklyGraph);
  }

  return { setup, display, setMode };
}

