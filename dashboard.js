// dashboard.js - Refactored for Stability, Scope Safety, and Modern UI/UX

import { CONFIG_DEFAULT_FILTER_SETTINGS } from './config.js';
import * as dataManager from './dataManager.js';

// ===========================================================
// 1. 전역 상태 변수
// ===========================================================
let currentStats = { dates: {} };
let currentBlockedUrls = [];
let currentSettings = {};
let currentSchedule = { scheduleActive: false, startMin: 0, endMin: 1440 };

let isBackgroundMode = false;
let isDailyMode = true;
let currentSettingsSubtab = 'media';

// DOM 요소 참조를 담을 객체 (스코프 문제 해결의 핵심)
const UI = {};

const SETTING_METADATA = {
    blur: { label: "화면 블러", type: "text", unit: "px", placeholder: "예: 1.5px" },
    delay: { label: "페이지 로딩 지연", type: "text", unit: "s", placeholder: "예: 0.5s" },
    clickDelay: { label: "클릭 지연", type: "number", unit: "ms", placeholder: "예: 1000", min: "0", step: "100" },
    scrollFriction: { label: "스크롤 마찰", type: "number", unit: "ms", placeholder: "예: 50", min: "0", step: "10" },
    desaturation: { label: "채도 감소", type: "text", unit: "%", placeholder: "예: 50%" },
    letterSpacing: { label: "텍스트 자간 늘리기", type: "text", unit: "em", placeholder: "예: 0.1em" },
    textOpacity: { label: "텍스트 투명도", type: "number", unit: "", placeholder: "예: 0.9", min: "0.1", step: "0.05" },
    textBlur: { label: "텍스트 블러", type: "number", unit: "px", placeholder: "예: 0.3", min: "0", step: "0.1" },
    mediaOpacity: { label: "미디어 투명도", type: "number", unit: "", placeholder: "예: 0.9", min: "0.1", step: "0.05" },
    mediaBrightness: { label: "미디어 밝기", type: "number", unit: "%", placeholder: "예: 90", min: "10", step: "5" },
};

// ===========================================================
// 2. 헬퍼 함수
// ===========================================================

const SETTING_METADATA_V2 = {
    // Media filters
    blur: { label: "블러", type: "number", unit: "px", unitSuffix: "px", storage: "cssUnit", category: "media", order: 10, placeholder: "1.5", min: "0", step: "0.1" },
    desaturation: { label: "채도 감소", type: "number", unit: "%", unitSuffix: "%", storage: "cssUnit", category: "media", order: 20, placeholder: "50", min: "0", step: "5" },
    mediaBrightness: { label: "밝기", type: "number", unit: "%", unitSuffix: "%", storage: "cssUnit", category: "media", order: 30, placeholder: "90", min: "0", step: "5" },
    mediaOpacity: { label: "투명도", type: "number", unit: "", unitSuffix: "", storage: "numberString", category: "media", order: 40, placeholder: "0.9", min: "0.05", step: "0.05" },

    // Text filters
    letterSpacing: { label: "자간", type: "number", unit: "em", unitSuffix: "em", storage: "cssUnit", category: "text", order: 10, placeholder: "0.1", min: "0", step: "0.01" },
    lineHeight: { label: "행간", type: "number", unit: "", unitSuffix: "", storage: "numberString", category: "text", order: 20, placeholder: "1.45", min: "1", step: "0.05" },
    textBlur: { label: "텍스트 블러", type: "number", unit: "px", unitSuffix: "px", storage: "cssUnit", category: "text", order: 30, placeholder: "0.3", min: "0", step: "0.1" },
    textOpacity: { label: "텍스트 투명도", type: "number", unit: "", unitSuffix: "", storage: "numberString", category: "text", order: 40, placeholder: "0.9", min: "0.05", step: "0.05" },
    textShadow: { label: "텍스트 그림자", type: "text", unit: "", unitSuffix: "", storage: "raw", category: "text", order: 50, placeholder: "예: 0 1px 0 rgba(0,0,0,0.25)" },
    textShuffle: { label: "셔플(단어)", type: "number", unit: "", unitSuffix: "", storage: "number", category: "text", order: 60, placeholder: "0.15", min: "0", step: "0.05" },

    // Delay filters
    delay: { label: "반응 지연", type: "text", unit: "", unitSuffix: "", storage: "raw", category: "delay", order: 10, placeholder: "예: 0.5s" },
    clickDelay: { label: "클릭 지연", type: "number", unit: "ms", unitSuffix: "", storage: "ms", category: "delay", order: 20, placeholder: "1000", min: "0", step: "100" },
    scrollFriction: { label: "스크롤 지연", type: "number", unit: "ms", unitSuffix: "", storage: "ms", category: "delay", order: 30, placeholder: "50", min: "0", step: "10" },
    inputDelay: { label: "입력 지연", type: "number", unit: "ms", unitSuffix: "", storage: "ms", category: "delay", order: 40, placeholder: "120", min: "0", step: "10" },
};

function mergeFilterSettings(partial) {
    const merged = {};
    const source = partial && typeof partial === 'object' ? partial : {};

    for (const [key, def] of Object.entries(CONFIG_DEFAULT_FILTER_SETTINGS)) {
        const current = source[key];
        merged[key] = {
            isActive: typeof current?.isActive === 'boolean' ? current.isActive : def.isActive,
            value: current?.value !== undefined ? current.value : def.value,
        };
    }

    for (const [key, value] of Object.entries(source)) {
        if (!(key in merged)) merged[key] = value;
    }

    return merged;
}

function minToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (minutes === 1440) return "24:00"; 
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

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
        const bar = e.target.closest('.bar-stack');
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

// ===========================================================
// 3. 핵심 데이터 로직 및 렌더링 컨트롤러
// ===========================================================

/**
 * 모든 DOM 요소를 한 번에 캐싱합니다.
 */
function initDOMReferences() {
    // 공통 및 네비게이션
    UI.tabs = document.querySelectorAll('.nav-btn');
    UI.contents = document.querySelectorAll('.tab-content');
    UI.darkModeToggle = document.getElementById('darkModeToggle');

    // Overview 탭
    UI.recapList = document.getElementById('recapList');
    UI.recapModeTitle = document.getElementById('recapModeTitle');
    UI.toggleRecapModeBtn = document.getElementById('toggleRecapMode');
    UI.sortByTime = document.getElementById('sortByTime');
    UI.sortByVisits = document.getElementById('sortByVisits');

    // Detailed Recap 탭
    UI.toggleDaily = document.getElementById('toggleDaily');
    UI.toggleWeekly = document.getElementById('toggleWeekly');
    UI.dailyDate = document.getElementById('dailyDate');
    UI.dailyTotal = document.getElementById('dailyTotal');
    UI.dailyBlocked = document.getElementById('dailyBlocked');
    UI.dailyChange = document.getElementById('dailyChange');
    UI.dailyGraph = document.getElementById('dailyGraph');
    UI.dailyInsight = document.getElementById('dailyInsight');
    UI.weeklyTotal = document.getElementById('weeklyTotal');
    UI.weeklyBlocked = document.getElementById('weeklyBlocked');
    UI.weeklyChange = document.getElementById('weeklyChange');
    UI.weeklyGraph = document.getElementById('weeklyGraph');
    UI.weeklyInsight = document.getElementById('weeklyInsight');

    // Blocklist 탭
    UI.blockedListDisplay = document.getElementById('blockedListDisplay');
    UI.newBlockUrlInput = document.getElementById('newBlockUrl');
    UI.addBlockBtn = document.getElementById('addBlockBtn');

    // Settings 탭
    UI.settingsGrid = document.querySelector('.settings-grid');
    UI.settingsSubtabButtons = document.querySelectorAll('.settings-subtab-btn');
    UI.saveSettingsBtn = document.getElementById('saveSettingsBtn');
    UI.saveStatus = document.getElementById('saveStatus');

    // Schedule 탭
    UI.scheduleContainer = document.getElementById('time-slider-container');
    UI.scheduleToggle = document.getElementById('schedule-toggle');
    UI.displayStart = document.getElementById('start-time-display');
    UI.displayEnd = document.getElementById('end-time-display');
    UI.sliderRange = document.getElementById('slider-range');
    UI.handleStart = document.getElementById('handle-start');
    UI.handleEnd = document.getElementById('handle-end');
    UI.trackWrapper = document.querySelector('#schedule .slider-track-wrapper');
}

/**
 * 저장소에서 데이터를 불러온 후 현재 활성화된 탭을 그립니다.
 */
function loadDataAndRender() {
    chrome.storage.local.get({
        stats: { dates: {} },
        blockedUrls: [],
        filterSettings: CONFIG_DEFAULT_FILTER_SETTINGS,
        darkMode: false,
        schedule: { scheduleActive: false, startMin: 0, endMin: 1440 }
    }, (items) => {
        currentStats = items.stats || { dates: {} };
        currentBlockedUrls = items.blockedUrls || [];
        currentSettings = mergeFilterSettings(items.filterSettings);
        currentSchedule = items.schedule;

        // 다크모드 적용
        if (items.darkMode) {
            document.body.classList.add('dark');
        } else {
            document.body.classList.remove('dark');
        }
        if (UI.darkModeToggle) {
            UI.darkModeToggle.checked = !!items.darkMode;
        }

        renderActiveTab();
    });

    chrome.runtime.sendMessage({ action: "DEBUG_GET_CACHE" }, (resp) => {
        if (resp && resp.cache && resp.loaded) {
            // background에 더 최신 데이터가 있을 수 있으므로 덮어쓰기
            currentStats = resp.cache;
            renderActiveTab();
        }
    });
}

/**
 * 현재 어떤 탭이 활성화되어 있는지 확인하여 해당 UI를 업데이트합니다.
 */
function renderActiveTab() {
    const activeTabBtn = document.querySelector('.nav-btn.active');
    if (!activeTabBtn) return;

    const activeTabId = activeTabBtn.dataset.tab;

    switch (activeTabId) {
        case 'overview': displayOverview(); break;
        case 'detailed-recap': displayDetailedRecap(); break;
        case 'blocklist': displayBlockList(); break;
        case 'settings': syncSettingsSubtabUI(); displaySettingsV2(); break;
        case 'schedule': initScheduleSlider(); break;
    }
}

// ===========================================================
// 4. 각 탭별 상세 렌더링 함수
// ===========================================================

function displayOverview(sortBy = 'time') {
    if (!UI.recapList) return;

    const statsByDomain = {};
    const today = dataManager.getTodayDateStr();
    const yesterday = dataManager.getYesterdayDateStr();

    [today, yesterday].forEach(date => {
        if (currentStats.dates[date]) {
            Object.entries(currentStats.dates[date].domains).forEach(([domain, data]) => {
                if (!statsByDomain[domain]) {
                    statsByDomain[domain] = { active: 0, background: 0, visits: 0 };
                }
                statsByDomain[domain].active += data.active || 0;
                statsByDomain[domain].background += data.background || 0;
                statsByDomain[domain].visits += data.visits || 0;
            });
        }
    });

    const list = Object.entries(statsByDomain).map(([domain, data]) => ({
        domain,
        active: data.active,
        background: data.background,
        visits: data.visits,
        isBlocked: currentBlockedUrls.includes(domain)
    }));

    const sortKey = isBackgroundMode ? 'background' : 'active';
    const effectiveSortKey = sortBy === 'visits' ? 'visits' : sortKey;

    const sorted = list
        .filter(item => item[effectiveSortKey] > 0)
        .sort((a, b) => b[effectiveSortKey] - a[effectiveSortKey]);

    const maxVal = sorted.length > 0 ? sorted[0][effectiveSortKey] : 1;

    UI.recapList.innerHTML = '';
    UI.recapModeTitle.textContent = isBackgroundMode ? '👻 백그라운드(Idle) 시간' : '📊 포그라운드(Active) 시간';
    
    sorted.forEach(item => {
        const timeToDisplay = isBackgroundMode ? item.background : item.active;
        const formattedTime = dataManager.formatTime(timeToDisplay);
        const barWidth = (item[effectiveSortKey] / maxVal) * 100;
        const blockClass = item.isBlocked ? 'is-blocked' : '';

        const recapItem = document.createElement('div');
        recapItem.className = 'recap-item';
        recapItem.innerHTML = `
            <div class="usage-bar ${blockClass}" style="width: ${barWidth}%"></div>
            <div class="recap-content">
                <div class="domain-info">
                    <div class="favicon" style="background-image: url('https://www.google.com/s2/favicons?domain=${item.domain}&sz=32')"></div>
                    <div class="text-group">
                        <span class="domain-name">${item.domain}</span>
                        <div class="insight">${item.visits}회 방문</div>
                    </div>
                </div>
                <div class="stats-group">
                    <div class="stats-numbers">
                        <div class="time" style="color: var(--accent);">${formattedTime}</div>
                    </div>
                    <button class="list-block-btn ${item.isBlocked ? 'is-blocked' : ''}" data-domain="${item.domain}">
                        ${item.isBlocked ? '해제' : '차단'}
                    </button>
                </div>
            </div>
        `;
        UI.recapList.appendChild(recapItem);
    });
}

function displayDetailedRecap() {
    if (isDailyMode) {
        document.getElementById('dailyAnalysis').classList.add('active');
        document.getElementById('weeklyAnalysis').classList.remove('active');
        const selectedDate = UI.dailyDate.value || dataManager.getTodayDateStr();
        renderDailyGraph(selectedDate);
    } else {
        document.getElementById('dailyAnalysis').classList.remove('active');
        document.getElementById('weeklyAnalysis').classList.add('active');
        renderWeeklyGraph();
    }
}

function renderDailyGraph(dateStr) {
    const { hourly, hourlyBlocked, total, blocked, change } = dataManager.getDailyData(currentStats, dateStr, currentBlockedUrls);

    UI.dailyTotal.textContent = dataManager.formatTime(total);
    UI.dailyBlocked.textContent = dataManager.formatTime(blocked);
    UI.dailyChange.textContent = change.startsWith('-') ? change : `+${change}`;
    UI.dailyChange.style.color = change.startsWith('-') ? 'var(--color-safe)' : 'var(--color-blocked)';

    UI.dailyGraph.innerHTML = '';
    const maxHour = Math.max(...hourly, 1);
    const hourLabels = Array.from({ length: 24 }, (_, h) => `${h}시`);
    const peak = findPeakBlockedRatio(hourly, hourlyBlocked, hourLabels);
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
        const tooltip = `${h}시\n총 ${dataManager.formatTime(time)}\n차단 ${dataManager.formatTime(blockedTime)} (${Math.round(blockedPct)}%)`;

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

        UI.dailyGraph.appendChild(barWrapper);
    });
}

function renderWeeklyGraph() {
    const { weekdayData, weekdayBlocked, total, blocked, change } = dataManager.getWeeklyData(currentStats, currentBlockedUrls);

    UI.weeklyTotal.textContent = dataManager.formatTime(total);
    UI.weeklyBlocked.textContent = dataManager.formatTime(blocked);
    UI.weeklyChange.textContent = change.startsWith('-') ? change : `+${change}`;
    UI.weeklyChange.style.color = change.startsWith('-') ? 'var(--color-safe)' : 'var(--color-blocked)';

    UI.weeklyGraph.innerHTML = '';
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
        const tooltip = `${days[idx]}\n총 ${dataManager.formatTime(time)}\n차단 ${dataManager.formatTime(blockedTime)} (${Math.round(blockedPct)}%)`;

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

        UI.weeklyGraph.appendChild(barWrapper);
    });
}

function displayBlockList() {
    if (!UI.blockedListDisplay) return;
    UI.blockedListDisplay.innerHTML = '';
    currentBlockedUrls.forEach(url => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${url}</span> <button class="list-block-btn is-blocked" data-url="${url}">삭제</button>`;
        UI.blockedListDisplay.appendChild(li);
    });
}

function displaySettings() {
    if (!UI.settingsGrid) return;
    UI.settingsGrid.innerHTML = '';

    Object.entries(currentSettings).forEach(([key, setting]) => {
        if (!SETTING_METADATA[key]) return;
        const meta = SETTING_METADATA[key];

        let inputValue = setting.value || '';
        if (typeof inputValue === 'string') {
            const match = inputValue.match(/^-?(\d*\.)?\d+/);
            if (match) inputValue = match[0];
        }
        
        const card = document.createElement('div');
        card.className = 'setting-card';
        card.innerHTML = `
            <div class="setting-header">
                <label>${meta.label}</label>
                <label class="switch">
                    <input type="checkbox" class="toggle-active" data-key="${key}" ${setting.isActive ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
            <div style="display: flex; align-items: center;">
                <input class="input-value" type="${meta.type === 'number' ? 'number' : 'text'}" 
                    
                    // 🔴 2. 추출된 숫자 값 사용
                    value="${inputValue}" 
                    
                    placeholder="${meta.placeholder || ''}"
                    ${meta.min ? `min="${meta.min}"` : ''} ${meta.step ? `step="${meta.step}"` : ''}
                    style="flex-grow: 1; padding: 10px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-main); color: var(--text-main);">
                <span style="margin-left: 10px; color: var(--text-muted);">${meta.unit || ''}</span>
            </div>
        `;
        UI.settingsGrid.appendChild(card);
    });
}

// ===========================================================
// 5. 스케줄 슬라이더 로직
// ===========================================================

function valueForInputV2(meta, storedValue) {
    const value = storedValue ?? '';

    if (meta.storage === 'ms') {
        if (typeof value === 'number') return value;
        const n = parseInt(String(value), 10);
        return Number.isFinite(n) ? n : 0;
    }

    if (meta.storage === 'raw') return String(value);

    if (meta.storage === 'cssUnit') {
        const s = String(value);
        if (meta.unitSuffix && s.endsWith(meta.unitSuffix)) return s.slice(0, -meta.unitSuffix.length);
        const match = s.match(/^-?(\\d*\\.)?\\d+/);
        return match ? match[0] : '';
    }

    if (meta.storage === 'number') {
        if (typeof value === 'number') return value;
        const n = parseFloat(String(value));
        return Number.isFinite(n) ? n : 0;
    }

    return String(value);
}

function valueForStorageV2(key, meta, inputValue) {
    const raw = String(inputValue ?? '').trim();
    const def = CONFIG_DEFAULT_FILTER_SETTINGS[key];
    const defaultValue = def ? def.value : '';

    if (raw === '') return defaultValue;

    if (meta.storage === 'ms') return parseInt(raw, 10) || 0;
    if (meta.storage === 'raw') return raw;
    if (meta.storage === 'cssUnit') return `${raw}${meta.unitSuffix || ''}`;
    if (meta.storage === 'number') return parseFloat(raw) || 0;

    return raw;
}

function collectSettingsFromGridV2() {
    document.querySelectorAll('.setting-card').forEach(card => {
        const toggle = card.querySelector('.toggle-active');
        const key = toggle?.dataset?.key;
        if (!key || !SETTING_METADATA_V2[key]) return;

        const meta = SETTING_METADATA_V2[key];
        const input = card.querySelector('.input-value');
        const value = valueForStorageV2(key, meta, input?.value);

        currentSettings[key] = {
            isActive: !!toggle.checked,
            value,
        };
    });
}

function syncSettingsSubtabUI() {
    if (!UI.settingsSubtabButtons) return;
    UI.settingsSubtabButtons.forEach(btn => {
        const isActive = btn.dataset.settingsSubtab === currentSettingsSubtab;
        btn.classList.toggle('is-active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
}

function setActiveSettingsSubtabV2(next) {
    const nextTab = next === 'text' || next === 'delay' ? next : 'media';
    if (currentSettingsSubtab === nextTab) return;

    collectSettingsFromGridV2();
    currentSettingsSubtab = nextTab;
    syncSettingsSubtabUI();
    displaySettingsV2();
}

function displaySettingsV2() {
    if (!UI.settingsGrid) return;
    UI.settingsGrid.innerHTML = '';

    const entries = Object.entries(SETTING_METADATA_V2)
        .filter(([, meta]) => meta.category === currentSettingsSubtab)
        .sort((a, b) => (a[1].order || 0) - (b[1].order || 0));

    entries.forEach(([key, meta]) => {
        const setting = currentSettings[key] || CONFIG_DEFAULT_FILTER_SETTINGS[key] || { isActive: false, value: '' };
        const inputValue = valueForInputV2(meta, setting.value);

        const card = document.createElement('div');
        card.className = 'setting-card';
        card.innerHTML = `
            <div class="setting-header">
                <label for="setting-${key}">${meta.label}</label>
                <label class="switch">
                    <input type="checkbox" class="toggle-active" data-key="${key}" ${setting.isActive ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
            <div style="display: flex; align-items: center;">
                <input id="setting-${key}" class="input-value" type="${meta.type === 'number' ? 'number' : 'text'}"
                    value="${String(inputValue).replace(/\"/g, '&quot;')}"
                    placeholder="${meta.placeholder || ''}"
                    ${meta.min ? `min="${meta.min}"` : ''} ${meta.step ? `step="${meta.step}"` : ''}
                    style="flex-grow: 1;">
                <span style="margin-left: 10px; color: var(--text-muted);">${meta.unit || ''}</span>
            </div>
        `;
        UI.settingsGrid.appendChild(card);
    });
}

function initScheduleSlider() {
    if (!UI.trackWrapper) return;

    function updateUI() {
        const startPct = (currentSchedule.startMin / 1440) * 100;
        const endPct = (currentSchedule.endMin / 1440) * 100;

        UI.handleStart.style.left = `${startPct}%`;
        UI.handleEnd.style.left = `${endPct}%`;
        UI.sliderRange.style.left = `${startPct}%`;
        UI.sliderRange.style.width = `${endPct - startPct}%`;

        UI.displayStart.textContent = minToTime(currentSchedule.startMin);
        UI.displayEnd.textContent = minToTime(currentSchedule.endMin);
        UI.scheduleToggle.checked = currentSchedule.scheduleActive;
        
        UI.scheduleContainer.style.opacity = currentSchedule.scheduleActive ? '1' : '0.4';
        UI.scheduleContainer.style.pointerEvents = currentSchedule.scheduleActive ? 'auto' : 'none';
    }

    function save() {
        chrome.storage.local.set({ schedule: currentSchedule }, () => {
            chrome.runtime.sendMessage({ action: 'SCHEDULE_UPDATED' });
        });
    }

    function setupDrag(el, isStart) {
        el.onmousedown = (e) => {
            e.preventDefault();
            const move = (me) => {
                const rect = UI.trackWrapper.getBoundingClientRect();
                let pct = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
                let mins = Math.round((pct * 1440) / 10) * 10;

                if (isStart) {
                    currentSchedule.startMin = Math.min(mins, currentSchedule.endMin - 10);
                } else {
                    currentSchedule.endMin = Math.max(mins, currentSchedule.startMin + 10);
                }
                updateUI();
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                save();
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        };
    }

    setupDrag(UI.handleStart, true);
    setupDrag(UI.handleEnd, false);
    updateUI();
}

// ===========================================================
// 6. 이벤트 리스너 통합 관리
// ===========================================================

function toggleBlockDomain(domain) {
    if (currentBlockedUrls.includes(domain)) {
        currentBlockedUrls = currentBlockedUrls.filter(u => u !== domain);
    } else {
        currentBlockedUrls.push(domain);
    }
    chrome.storage.local.set({ blockedUrls: currentBlockedUrls }, () => {
        renderActiveTab();
    });
}

document.addEventListener('DOMContentLoaded', () => {
    initDOMReferences();
    
    // 초기 날짜 설정
    if (UI.dailyDate) {
        UI.dailyDate.value = dataManager.getTodayDateStr();
        UI.dailyDate.max = dataManager.getTodayDateStr();
    }

    loadDataAndRender();

    bindChartTooltip(UI.dailyGraph);
    bindChartTooltip(UI.weeklyGraph);

    // 1. 탭 전환
    UI.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const prevTabId = document.querySelector('.nav-btn.active')?.dataset?.tab;
            if (prevTabId === 'settings') collectSettingsFromGridV2();
            UI.tabs.forEach(t => t.classList.remove('active'));
            UI.contents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            const target = document.getElementById(tab.dataset.tab);
            if (target) target.classList.add('active');

            renderActiveTab();
        });
    });

    // 2. 다크 모드 토글 (UI 즉시 갱신 포함)
    if (UI.darkModeToggle) UI.darkModeToggle.addEventListener('change', () => {
        const isDark = !!UI.darkModeToggle.checked;
        document.body.classList.toggle('dark', isDark);
        chrome.storage.local.set({ darkMode: isDark }, () => {
            // 다크모드 변경 후 UI 요소들의 가독성을 위해 현재 탭 재렌더링
            renderActiveTab();
        });
    });

    // 3. Overview 제어
    UI.toggleRecapModeBtn.addEventListener('click', () => {
        isBackgroundMode = !isBackgroundMode;
        UI.toggleRecapModeBtn.textContent = isBackgroundMode ? '포그라운드 보기' : '백그라운드 보기';
        displayOverview();
    });

    UI.sortByTime.addEventListener('click', () => {
        UI.sortByTime.classList.add('active');
        UI.sortByVisits.classList.remove('active');
        displayOverview('time');
    });

    UI.sortByVisits.addEventListener('click', () => {
        UI.sortByVisits.classList.add('active');
        UI.sortByTime.classList.remove('active');
        displayOverview('visits');
    });

    UI.recapList.addEventListener('click', (e) => {
        if (e.target.classList.contains('list-block-btn')) {
            toggleBlockDomain(e.target.dataset.domain);
        }
    });

    // 4. Detailed Recap 제어
    UI.toggleDaily.addEventListener('click', () => {
        isDailyMode = true;
        UI.toggleDaily.classList.add('active');
        UI.toggleWeekly.classList.remove('active');
        displayDetailedRecap();
    });

    UI.toggleWeekly.addEventListener('click', () => {
        isDailyMode = false;
        UI.toggleWeekly.classList.add('active');
        UI.toggleDaily.classList.remove('active');
        displayDetailedRecap();
    });

    UI.dailyDate.addEventListener('change', displayDetailedRecap);

    // 5. Blocklist 제어
    UI.addBlockBtn.addEventListener('click', () => {
        let url = UI.newBlockUrlInput.value.trim().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
        if (url) {
            toggleBlockDomain(url);
            UI.newBlockUrlInput.value = '';
        }
    });

    UI.blockedListDisplay.addEventListener('click', (e) => {
        if (e.target.classList.contains('list-block-btn')) {
            toggleBlockDomain(e.target.dataset.url);
        }
    });

    // 6. Settings 저장
    if (UI.settingsSubtabButtons) {
        UI.settingsSubtabButtons.forEach(btn => {
            btn.addEventListener('click', () => setActiveSettingsSubtabV2(btn.dataset.settingsSubtab));
        });
        syncSettingsSubtabUI();
    }

    UI.saveSettingsBtn.addEventListener('click', () => {
        collectSettingsFromGridV2();
        const newSettingsV2 = mergeFilterSettings(currentSettings);

        chrome.storage.local.set({ filterSettings: newSettingsV2 }, () => {
            UI.saveStatus.textContent = '설정 저장 완료!';
            setTimeout(() => UI.saveStatus.textContent = '', 2000);
            chrome.runtime.sendMessage({ action: "SETTINGS_UPDATED" });
            currentSettings = newSettingsV2;
        });
        return;

        const newSettings = {};
    document.querySelectorAll('.setting-card').forEach(card => {
        const toggle = card.querySelector('.toggle-active');
        const key = toggle.dataset.key;
        const input = card.querySelector('.input-value');
        
        // 1. 저장할 값의 기본값은 입력된 값으로 설정
        let valueToSave = input.value;

        if (key === 'clickDelay' || key === 'scrollFriction') {
            // 2. 시간(ms) 설정: 정수형으로 파싱 (0이 입력될 경우 0 저장)
            valueToSave = parseInt(input.value, 10) || 0;
        } else {
            // 3. CSS 설정 (px, s, %, em): SETTING_METADATA에서 단위를 가져와 재결합
            const unit = SETTING_METADATA[key]?.unit || '';
            valueToSave = input.value + unit;
        }

        newSettings[key] = { 
            isActive: toggle.checked,
            value: valueToSave // 최종적으로 단위가 붙거나 정수형으로 변환된 값
        };
    });

        chrome.storage.local.set({ filterSettings: newSettings }, () => {
            UI.saveStatus.textContent = '✅ 저장 완료!';
            setTimeout(() => UI.saveStatus.textContent = '', 2000);
            chrome.runtime.sendMessage({ action: "SETTINGS_UPDATED" });
            currentSettings = newSettings;
        });
    });

    // 7. Schedule 토글
    UI.scheduleToggle.addEventListener('change', (e) => {
        currentSchedule.scheduleActive = e.target.checked;
        chrome.storage.local.set({ schedule: currentSchedule }, () => {
            renderActiveTab();
            chrome.runtime.sendMessage({ action: 'SCHEDULE_UPDATED' });
        });
    });
});
