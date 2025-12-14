import { CONFIG_DEFAULT_FILTER_SETTINGS } from './config.js';

const DEFAULT_FILTER_SETTINGS = CONFIG_DEFAULT_FILTER_SETTINGS;

function mergeFilterSettings(partial) {
    const merged = {};
    const source = partial && typeof partial === 'object' ? partial : {};

    for (const [key, def] of Object.entries(DEFAULT_FILTER_SETTINGS)) {
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
const TRACKING_INTERVAL_MS = 20000; // 20초
const MAX_ELAPSED_LIMIT = TRACKING_INTERVAL_MS * 1.5;
const MAX_DAYS_STORED = 30;

let statsCache = { dates: {} };
let cacheLoaded = false;
let saveTimer = null;
let lastActiveTabId = null;

const CACHE_SAVE_INTERVAL_MS = 300000;

setInterval(() => {
    saveStatsCache();  // 전체 강제 저장
}, CACHE_SAVE_INTERVAL_MS);

// ===========================================================
// 1. 저장 관련 함수들
// ===========================================================

let savePending = null;

function saveStatsDebounced() {
    if (savePending) clearTimeout(savePending);
    savePending = setTimeout(() => {
        saveStatsCache();
        savePending = null;
    }, 300);
}

async function loadStatsCache() {
    if (cacheLoaded) return;
    try {
        const data = await chrome.storage.local.get('stats');
        
        if (!data.stats || typeof data.stats !== 'object' || !data.stats.dates || typeof data.stats.dates !== 'object') {
            statsCache = { dates: {} };
        } else {
            statsCache = data.stats;
        }
        
        pruneOldData();
        cacheLoaded = true;
    } catch (e) {
        console.error("Failed to load stats cache:", e);
        statsCache = { dates: {} };
        cacheLoaded = true;
    }
}

async function saveStatsCache() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }

    const dataToSave = {
        stats: (statsCache && typeof statsCache === 'object' && statsCache.dates && typeof statsCache.dates === 'object')
            ? statsCache
            : { dates: {} }
    };

    try {
        await chrome.storage.local.set(dataToSave);
    } catch (e) {
        console.error("Failed to save stats cache:", e);
        statsCache = { dates: {} };
    }
}

function scheduleCacheSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(saveStatsCache, CACHE_SAVE_INTERVAL_MS);
}

function pruneOldData() {
    if (!statsCache.dates || typeof statsCache.dates !== 'object') {
        statsCache.dates = {};
        return;
    }

    const dates = Object.keys(statsCache.dates);
    if (!Array.isArray(dates) || dates.length <= MAX_DAYS_STORED) {
        return;
    }

    dates.sort();
    for (let i = 0; i < dates.length - MAX_DAYS_STORED; i++) {
        delete statsCache.dates[dates[i]];
    }
}

// ===========================================================
// 2. Helpers
// ===========================================================

function getHostname(url) {
    try {
        const u = new URL(url);
        return u.hostname.replace(/^www\./, '');
    } catch (e) { return null; }
}

const ensureNumber = (val) => (typeof val === 'number' && !isNaN(val) ? val : 0);

function checkTimeCondition(schedule) {
    if (!schedule || !schedule.scheduleActive) return true;
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const { startMin, endMin } = schedule;
    if (startMin < endMin) {
        return currentMinutes >= startMin && currentMinutes < endMin;
    } else {
        return currentMinutes >= startMin || currentMinutes < endMin;
    }
}

function getLocalDateStr(ts = Date.now()) {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

// ===========================================================
// 3. 핵심 로직: 시간 계산
// ===========================================================

async function calculateTabTime(hostname, now, isActive) {
    const dateStr = getLocalDateStr(now);
    const hour = new Date(now).getHours();
    
    if (!statsCache.dates[dateStr]) {
        statsCache.dates[dateStr] = { 
            domains: {}, 
            totals: { 
                totalActive: 0, 
                totalBackground: 0, 
                blockedActive: 0, 
                blockedBackground: 0 
            } 
        };
    }

    const dateData = statsCache.dates[dateStr];
    if (!dateData.domains[hostname]) {
        dateData.domains[hostname] = { 
            active: 0, 
            background: 0, 
            visits: 0, 
            hourly: Array(24).fill(0), 
            lastTrackedTime: now 
        };
        return true;
    }

    const domainData = dateData.domains[hostname];
    const lastTime = ensureNumber(domainData.lastTrackedTime);
    
    if (lastTime === 0) {
        domainData.lastTrackedTime = now;
        return true;
    }

    let elapsed = now - lastTime;
    if (elapsed > MAX_ELAPSED_LIMIT) elapsed = MAX_ELAPSED_LIMIT;
    
    // 디버깅용 로그 (필요시 주석 해제)
    // console.log(`[${hostname}] Elapsed: ${elapsed}ms, Active: ${isActive}, LastTime: ${new Date(lastTime).toLocaleTimeString()}`);
    
    if (elapsed < 500) return false;

    const timeType = isActive ? 'active' : 'background';
    domainData[timeType] += elapsed;
    domainData.hourly[hour] += elapsed;
    domainData.lastTrackedTime = now;

    // Update totals
    dateData.totals[`total${timeType.charAt(0).toUpperCase() + timeType.slice(1)}`] += elapsed;

    // Blocked check
    const items = await chrome.storage.local.get('blockedUrls');
    const blockedUrls = items.blockedUrls || [];
    if (blockedUrls.includes(hostname)) {
        dateData.totals[`blocked${timeType.charAt(0).toUpperCase() + timeType.slice(1)}`] += elapsed;
    }

    return true;
}

async function settleTabTime(url, isActive, isNewVisit = false) {
    await loadStatsCache();
    const hostname = getHostname(url);

    if (!hostname || url.startsWith('chrome://') || hostname === chrome.runtime.id) return;
    
    const now = Date.now();
    let isChanged = await calculateTabTime(hostname, now, isActive);
    
    if (isNewVisit) {
        const dateStr = getLocalDateStr(now);
        if (statsCache.dates[dateStr] && statsCache.dates[dateStr].domains[hostname]) {
            statsCache.dates[dateStr].domains[hostname].visits += 1;
            isChanged = true;
        }
    }
    
    if (isChanged) {
        // scheduleCacheSave();

        // 개발, 디버깅용 즉시 저장
        // saveStatsCache().catch(e => console.error("Immediate save failed:", e));

        // 디바운스된 저장 함수 호출
        saveStatsDebounced();
    } 
}

// ✨ 수정: 이전 탭 시간을 정산하는 함수 추가
async function settlePreviousTab() {
    if (lastActiveTabId === null) return;
    
    try {
        const tab = await chrome.tabs.get(lastActiveTabId);
        if (tab && tab.url) {
            await settleTabTime(tab.url, false, false);
        }
    } catch (e) {
        // 탭이 닫혔을 수 있음
    }
}

// 1분 주기 배치 처리
async function trackAllTabsBatch() {
    await loadStatsCache();
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    let isChanged = false;
    
    for (const tab of tabs) {
        const hostname = getHostname(tab.url);
        if (!hostname || tab.url.startsWith('chrome://') || hostname === chrome.runtime.id) continue;
        if (await calculateTabTime(hostname, now, tab.active)) isChanged = true;
    }
    
    if (isChanged) scheduleCacheSave();
}

// ===========================================================
// 4. 필터링 및 메시지 전송
// ===========================================================

async function sendFrictionMessage(tabId, url) {
    if (!url || url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

    const items = await chrome.storage.local.get({
        blockedUrls: [],
        filterSettings: DEFAULT_FILTER_SETTINGS,
        schedule: { scheduleActive: false, startMin: 0, endMin: 1440 }
    });

    const hostname = getHostname(url);
    const isBlocked = hostname && items.blockedUrls.includes(hostname);
    
    const isTimeActive = checkTimeCondition(items.schedule);
    const shouldApplyFilter = isBlocked && isTimeActive;

    try {
        await chrome.tabs.sendMessage(tabId, {
            isBlocked: shouldApplyFilter,
            filters: mergeFilterSettings(items.filterSettings),
        });
    } catch (e) {
        // 탭이 아직 로드되지 않았거나 닫힌 경우 무시
    }
}

async function broadcastSettingsUpdate() {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.url) await sendFrictionMessage(tab.id, tab.url);
    }
}

async function checkScheduleStatus() {
    const items = await chrome.storage.local.get({
        schedule: { scheduleActive: false, startMin: 0, endMin: 1440 }
    });
    
    const isCurrentlyActive = checkTimeCondition(items.schedule);
    const sessionData = await chrome.storage.session.get('lastScheduleState');
    const lastState = sessionData.lastScheduleState;

    if (lastState === undefined || lastState !== isCurrentlyActive) {
        await chrome.storage.session.set({ lastScheduleState: isCurrentlyActive });
        await broadcastSettingsUpdate();
    }
}

// ===========================================================
// 5. 이벤트 리스너 (✨ 모두 async/await로 수정)
// ===========================================================

// 1분 알람
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'oneMinuteTick') {
        await trackAllTabsBatch();
        await checkScheduleStatus();
    }
});

// 메시지 수신
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // IMPORTANT: Only return true when we will actually call sendResponse asynchronously.
    // Otherwise, sendMessage(Promise) can reject with "message channel closed" errors.
    if (!request || typeof request.action !== 'string') return false;
    const knownActions = new Set([
        "SETTINGS_UPDATED",
        "SCHEDULE_UPDATED",
        "DEBUG_GET_CACHE",
        "DEBUG_FORCE_SAVE",
        "DEBUG_TRACK_NOW",
    ]);
    if (!knownActions.has(request.action)) return false;
    if (request.action === "SETTINGS_UPDATED" || request.action === "SCHEDULE_UPDATED") {
        // async 함수를 즉시 실행
        (async () => {
            await broadcastSettingsUpdate();
            await checkScheduleStatus();
        })().catch((e) => console.error("Error handling settings/schedule update:", e));
        sendResponse({ success: true });
        return false;
    }
    
    // ✨ 디버깅용 메시지 핸들러
    if (request.action === "DEBUG_GET_CACHE") {
        sendResponse({ 
            cache: statsCache, 
            loaded: cacheLoaded,
            lastActiveTab: lastActiveTabId 
        });
        return false;
    }
    
    if (request.action === "DEBUG_FORCE_SAVE") {
        saveStatsCache().then(() => {
            sendResponse({ success: true, message: "저장 완료" });
        }).catch((e) => {
            console.error("DEBUG_FORCE_SAVE failed:", e);
            sendResponse({ success: false });
        });
        return true;
    }

    if (request.action === "DEBUG_TRACK_NOW") {
        trackAllTabsBatch().then(() => {
            sendResponse({ success: true, message: "추적 완료", cache: statsCache });
        }).catch((e) => {
            console.error("DEBUG_TRACK_NOW failed:", e);
            sendResponse({ success: false });
        });
        return true;
    }
    
    return true; // 비동기 응답을 위해 true 반환
});

// 탭 업데이트 (✨ async로 변경)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (tab.url && changeInfo.status === 'complete') {
        await sendFrictionMessage(tabId, tab.url);
        await settleTabTime(tab.url, tab.active, true);
    }
});

// 탭 활성화 (✨ 이전 탭 정산 추가)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    // 1. 이전 활성 탭의 시간을 먼저 정산
    await settlePreviousTab();
    
    // 2. 새로운 활성 탭 처리
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url) {
            await sendFrictionMessage(tab.id, tab.url);
            await settleTabTime(tab.url, true, false);
            lastActiveTabId = activeInfo.tabId;
        }
    } catch (e) {
        console.error("Error handling tab activation:", e);
    }
});

// 브라우저 포커스 변경 (✨ async로 변경)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        try {
            const window = await chrome.windows.get(windowId, { populate: true });
            const activeTab = window.tabs.find(t => t.active);
            if (activeTab && activeTab.url) {
                await sendFrictionMessage(activeTab.id, activeTab.url);
                await settleTabTime(activeTab.url, true, false);
                lastActiveTabId = activeTab.id;
            }
        } catch (e) {
            console.error("Error handling window focus:", e);
        }
    } else {
        // 포커스 상실 시
        await trackAllTabsBatch();
        await saveStatsCache();
    }
});

// ✨ Service Worker 종료 직전 (async로 변경)
chrome.runtime.onSuspend.addListener(async () => {
    console.log("Service worker suspending - saving data...");
    await saveStatsCache();
});

// 초기화
(async () => {
    await loadStatsCache();
    chrome.alarms.create('oneMinuteTick', { periodInMinutes: 1 });
    
    // 현재 활성 탭 추적 시작
    try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (activeTab) {
            lastActiveTabId = activeTab.id;
        }
    } catch (e) {
        console.error("Error initializing active tab:", e);
    }
})();
