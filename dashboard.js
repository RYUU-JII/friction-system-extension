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

// DOM 요소 참조를 담을 객체 (스코프 문제 해결의 핵심)
const UI = {};

const SETTING_METADATA = {
    blur: { label: "화면 블러", type: "text", unit: "px", placeholder: "예: 1.5px" },
    delay: { label: "페이지 로딩 지연", type: "text", unit: "s", placeholder: "예: 0.5s" },
    clickDelay: { label: "클릭 지연", type: "number", unit: "ms", placeholder: "예: 1000", min: "0", step: "100" },
    scrollFriction: { label: "스크롤 마찰", type: "number", unit: "ms", placeholder: "예: 50", min: "0", step: "10" },
    desaturation: { label: "채도 감소", type: "text", unit: "%", placeholder: "예: 50%" },
    letterSpacing: { label: "텍스트 자간 늘리기", type: "text", unit: "em", placeholder: "예: 0.1em" },
};

// ===========================================================
// 2. 헬퍼 함수
// ===========================================================

function minToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (minutes === 1440) return "24:00"; 
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
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
    UI.weeklyTotal = document.getElementById('weeklyTotal');
    UI.weeklyBlocked = document.getElementById('weeklyBlocked');
    UI.weeklyChange = document.getElementById('weeklyChange');
    UI.weeklyGraph = document.getElementById('weeklyGraph');

    // Blocklist 탭
    UI.blockedListDisplay = document.getElementById('blockedListDisplay');
    UI.newBlockUrlInput = document.getElementById('newBlockUrl');
    UI.addBlockBtn = document.getElementById('addBlockBtn');

    // Settings 탭
    UI.settingsGrid = document.querySelector('.settings-grid');
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
        currentSettings = items.filterSettings || CONFIG_DEFAULT_FILTER_SETTINGS;
        currentSchedule = items.schedule;

        // 다크모드 적용
        if (items.darkMode) {
            document.body.classList.add('dark');
        } else {
            document.body.classList.remove('dark');
        }

        renderActiveTab();
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
        case 'settings': displaySettings(); break;
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

        const recapItem = document.createElement('div');
        recapItem.className = 'recap-item';
        recapItem.innerHTML = `
            <div class="usage-bar" style="width: ${barWidth}%"></div>
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

    hourly.forEach((time, h) => {
        const height = (time / maxHour) * 100;
        const barWrapper = document.createElement('div');
        barWrapper.className = 'bar-wrapper';
        barWrapper.innerHTML = `
            <div class="bar" style="height: ${height}%">
                <div class="bar blocked" style="height: ${time > 0 ? (hourlyBlocked[h] / time) * 100 : 0}%; position: absolute; bottom: 0; width: 100%;"></div>
            </div>
            ${h % 3 === 0 ? `<div style="position: absolute; bottom: -20px; width: 100%; text-align: center; font-size: 0.8rem; color: var(--text-muted);">${h}</div>` : ''}
        `;
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

    weekdayData.forEach((time, idx) => {
        const height = (time / maxDay) * 100;
        const barWrapper = document.createElement('div');
        barWrapper.className = 'bar-wrapper';
        barWrapper.style.width = '14%';
        barWrapper.innerHTML = `
            <div class="bar" style="height: ${height}%">
                <div class="bar blocked" style="height: ${time > 0 ? (weekdayBlocked[idx] / time) * 100 : 0}%; position: absolute; bottom: 0; width: 100%;"></div>
            </div>
            <div style="position: absolute; bottom: -20px; width: 100%; text-align: center; font-weight: 500; color: var(--text-muted);">${days[idx]}</div>
        `;
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
                       value="${setting.value || ''}" placeholder="${meta.placeholder || ''}"
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

    // 1. 탭 전환
    UI.tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            UI.tabs.forEach(t => t.classList.remove('active'));
            UI.contents.forEach(c => c.classList.remove('active'));
            
            tab.classList.add('active');
            const target = document.getElementById(tab.dataset.tab);
            if (target) target.classList.add('active');

            renderActiveTab();
        });
    });

    // 2. 다크 모드 토글 (UI 즉시 갱신 포함)
    UI.darkModeToggle.addEventListener('click', () => {
        document.body.classList.toggle('dark');
        const isDark = document.body.classList.contains('dark');
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
    UI.saveSettingsBtn.addEventListener('click', () => {
        const newSettings = {};
        document.querySelectorAll('.setting-card').forEach(card => {
            const toggle = card.querySelector('.toggle-active');
            const key = toggle.dataset.key;
            const input = card.querySelector('.input-value');
            
            newSettings[key] = { 
                isActive: toggle.checked,
                value: (key === 'clickDelay' || key === 'scrollFriction') ? parseInt(input.value, 10) : input.value
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