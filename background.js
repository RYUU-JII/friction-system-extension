import { CONFIG_DEFAULT_FILTER_SETTINGS } from './config.js';
import { isFrictionTime, getLocalDateStr, ensureNumber, getHostname } from './utils/utils.js';

const DEFAULT_FILTER_SETTINGS = CONFIG_DEFAULT_FILTER_SETTINGS;

const DEFAULT_NUDGE_CONFIG = {
    enabled: true,
    thresholdMs: 30 * 60 * 1000,
    spriteSizePx: 96,
    baseSpeedPxPerSec: 140,
    spawnIntervalMs: 4000,
    maxSprites: 6,
    speedRamp: 1.15,
    asset: {
        gifPath: 'samples/images/nudge-object.gif',
        audioPath: 'samples/sounds/nudge-music.mp3',
        label: 'rat-dance',
    },
};

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
// Tracking is driven by a 1-minute chrome.alarms tick (plus tab/window events).
// Keep the clamp aligned with that cadence to avoid systematic under-counting.
const TRACKING_INTERVAL_MS = 60_000; // 1 minute
const MAX_ELAPSED_LIMIT = TRACKING_INTERVAL_MS * 2;
const MAX_DAYS_STORED = 30;

let statsCache = { dates: {} };
let cacheLoaded = false;
let saveTimer = null;
let lastActiveTabId = null;
let focusedWindowId = null;

const CACHE_SAVE_INTERVAL_MS = 300000;

setInterval(() => {
    saveStatsCache();  // 전체 강제 저장
}, CACHE_SAVE_INTERVAL_MS);

function mergeNudgeConfig(partial) {
    const src = partial && typeof partial === 'object' ? partial : {};
    return {
        ...DEFAULT_NUDGE_CONFIG,
        ...src,
        asset: {
            ...DEFAULT_NUDGE_CONFIG.asset,
            ...(src.asset && typeof src.asset === 'object' ? src.asset : {}),
        },
    };
}

function getNudgeDayKey(dateStr, hostname) {
    return `${dateStr}|${hostname}`;
}

async function isNudgeShown(key) {
    const session = await chrome.storage.session.get({ nudgeShown: {} });
    return !!session.nudgeShown?.[key];
}

async function markNudgeShown(key) {
    const session = await chrome.storage.session.get({ nudgeShown: {} });
    const nudgeShown = session.nudgeShown || {};
    if (nudgeShown[key]) return;
    nudgeShown[key] = Date.now();
    await chrome.storage.session.set({ nudgeShown });
}

async function markNudgeAck(key) {
    const session = await chrome.storage.session.get({ nudgeAck: {} });
    const nudgeAck = session.nudgeAck || {};
    if (nudgeAck[key]) return;
    nudgeAck[key] = Date.now();
    await chrome.storage.session.set({ nudgeAck });
}

async function maybeTriggerNudge(tabId, url, { force = false } = {}) {
    if (!tabId || !url) return;
    if (url.startsWith('chrome://') || url.startsWith('chrome-extension://')) return;

    await loadStatsCache();
    const hostname = getHostname(url);
    if (!hostname) return;

    const dateStr = getLocalDateStr();
    const key = getNudgeDayKey(dateStr, hostname);

    const items = await chrome.storage.local.get({
        blockedUrls: [],
        schedule: { scheduleActive: false, startMin: 0, endMin: 1440 },
        nudgeConfig: {},
    });

    if (!Array.isArray(items.blockedUrls) || !items.blockedUrls.includes(hostname)) return;
    if (!isFrictionTime(items.schedule)) return;

    const config = mergeNudgeConfig(items.nudgeConfig);
    if (!config.enabled && !force) return;

    if (!force) {
        if (await isNudgeShown(key)) return;
        const domainData = statsCache?.dates?.[dateStr]?.domains?.[hostname];
        const activeMs = domainData ? ensureNumber(domainData.active) : 0;
        if (activeMs < ensureNumber(config.thresholdMs)) return;
    }

    try {
        await chrome.tabs.sendMessage(tabId, {
            type: 'NUDGE_START',
            payload: {
                hostname,
                dateStr,
                config,
                reason: force ? 'debug' : 'threshold',
            },
        });
        await markNudgeShown(key);
    } catch (e) {
        // content script not ready / tab unavailable
    }
}

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
        const migrated = migrateLegacyHourlyData();
        if (migrated) saveStatsDebounced();
        cacheLoaded = true;
    } catch (e) {
        console.error("Failed to load stats cache:", e);
        statsCache = { dates: {} };
        cacheLoaded = true;
    }
}

function ensureHourlyArrays(domainData) {
    if (!domainData || typeof domainData !== 'object') return;

    const normalize24 = (val) => {
        const arr = Array(24).fill(0);
        if (!val) return arr;

        // Array (may be shorter/longer).
        if (Array.isArray(val)) {
            for (let i = 0; i < 24; i++) arr[i] = ensureNumber(val[i]);
            return arr;
        }

        // Legacy object shape: { "0": ms, ... } or { 0: ms, ... }.
        if (typeof val === 'object') {
            for (let i = 0; i < 24; i++) {
                arr[i] = ensureNumber(val[i] ?? val[String(i)]);
            }
            return arr;
        }

        return arr;
    };

    if (!Array.isArray(domainData.hourly) || domainData.hourly.length !== 24) {
        domainData.hourly = normalize24(domainData.hourly);
    }
    if (!Array.isArray(domainData.hourlyActive) || domainData.hourlyActive.length !== 24) {
        domainData.hourlyActive = normalize24(domainData.hourlyActive);
    }
    if (!Array.isArray(domainData.hourlyBackground) || domainData.hourlyBackground.length !== 24) {
        domainData.hourlyBackground = normalize24(domainData.hourlyBackground);
    }
}

function addElapsedToHourly(domainData, startTs, endTs, isActive) {
    if (!domainData || typeof domainData !== 'object') return;
    if (!Number.isFinite(startTs) || !Number.isFinite(endTs) || endTs <= startTs) return;

    ensureHourlyArrays(domainData);

    let cursor = startTs;
    while (cursor < endTs) {
        const cursorDate = new Date(cursor);
        const hourIdx = cursorDate.getHours();

        const nextHour = new Date(cursorDate);
        nextHour.setMinutes(60, 0, 0);
        const sliceEnd = Math.min(endTs, nextHour.getTime());
        const sliceMs = sliceEnd - cursor;

        if (sliceMs > 0) {
            domainData.hourly[hourIdx] += sliceMs;
            if (isActive) domainData.hourlyActive[hourIdx] += sliceMs;
            else domainData.hourlyBackground[hourIdx] += sliceMs;
        }

        cursor = sliceEnd;
    }
}

function migrateLegacyHourlyData() {
    if (!statsCache?.dates || typeof statsCache.dates !== 'object') return false;

    let changed = false;

    for (const dateData of Object.values(statsCache.dates)) {
        const domains = dateData?.domains;
        if (!domains || typeof domains !== 'object') continue;

        for (const domainData of Object.values(domains)) {
            if (!domainData || typeof domainData !== 'object') continue;

            const hasHourlyActive = Array.isArray(domainData.hourlyActive) && domainData.hourlyActive.length === 24;
            const hasHourlyBackground = Array.isArray(domainData.hourlyBackground) && domainData.hourlyBackground.length === 24;
            const hasLegacyHourly = domainData.hourly && (Array.isArray(domainData.hourly) || typeof domainData.hourly === 'object');

            if (hasHourlyActive && hasHourlyBackground) continue;

            ensureHourlyArrays(domainData);
            changed = true;

            if (!hasLegacyHourly) continue;

            const active = ensureNumber(domainData.active);
            const background = ensureNumber(domainData.background);
            const sum = active + background;
            const ratio = sum > 0 ? (active / sum) : 0;

            for (let h = 0; h < 24; h++) {
                const raw = ensureNumber(domainData.hourly[h]);
                const estActive = Math.max(0, Math.round(raw * ratio));
                domainData.hourlyActive[h] = estActive;
                domainData.hourlyBackground[h] = Math.max(0, raw - estActive);
            }
        }

        // Legacy data can create impossible "active" totals per hour. Clamp to <= 1h/hour.
        for (let h = 0; h < 24; h++) {
            let totalActiveThisHour = 0;
            for (const domainData of Object.values(domains)) {
                totalActiveThisHour += ensureNumber(domainData?.hourlyActive?.[h]);
            }
            if (totalActiveThisHour <= 3600000) continue;

            const scale = 3600000 / totalActiveThisHour;
            for (const domainData of Object.values(domains)) {
                if (!Array.isArray(domainData?.hourlyActive) || domainData.hourlyActive.length !== 24) continue;
                domainData.hourlyActive[h] = Math.floor(ensureNumber(domainData.hourlyActive[h]) * scale);
            }
            changed = true;
        }
    }

    return changed;
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
// 3. 핵심 로직: 시간 계산
// ===========================================================

async function calculateTabTime(hostname, now, isActive, blockedUrlsOverride = null) {
    const dateStr = getLocalDateStr(now);
    
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
            hourlyActive: Array(24).fill(0),
            hourlyBackground: Array(24).fill(0),
            lastTrackedTime: now 
        };
        return true;
    }

    const domainData = dateData.domains[hostname];
    ensureHourlyArrays(domainData);
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
    addElapsedToHourly(domainData, lastTime, now, isActive);
    domainData.lastTrackedTime = now;

    // Update totals
    dateData.totals[`total${timeType.charAt(0).toUpperCase() + timeType.slice(1)}`] += elapsed;

    // Blocked check
    const blockedUrls = Array.isArray(blockedUrlsOverride)
        ? blockedUrlsOverride
        : ((await chrome.storage.local.get('blockedUrls')).blockedUrls || []);
    if (blockedUrls.includes(hostname)) {
        dateData.totals[`blocked${timeType.charAt(0).toUpperCase() + timeType.slice(1)}`] += elapsed;
    }

    return true;
}

async function settleTabTime(url, isActive, isNewVisit = false, nowOverride = null) {
    await loadStatsCache();
    const hostname = getHostname(url);

    if (!hostname || url.startsWith('chrome://') || hostname === chrome.runtime.id) return;
    
    const now = typeof nowOverride === 'number' ? nowOverride : Date.now();
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
async function settlePreviousTab(nowOverride = null) {
    if (lastActiveTabId === null) return;
    
    try {
        const tab = await chrome.tabs.get(lastActiveTabId);
        if (tab && tab.url) {
            await settleTabTime(tab.url, true, false, nowOverride);
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
    
    const items = await chrome.storage.local.get('blockedUrls');
    const blockedUrls = Array.isArray(items.blockedUrls) ? items.blockedUrls : [];

    // Track per hostname once per tick (avoids order-dependent active/background assignment).
    const hostStates = new Map(); // hostname -> { isActive: boolean }
    for (const tab of tabs) {
        const hostname = getHostname(tab.url);
        if (!hostname || tab.url.startsWith('chrome://') || hostname === chrome.runtime.id) continue;

        const isForegroundActive =
            focusedWindowId !== null ? (tab.active && tab.windowId === focusedWindowId) : false;
        const prev = hostStates.get(hostname) || { isActive: false };
        if (isForegroundActive) prev.isActive = true;
        hostStates.set(hostname, prev);
    }

    for (const [hostname, state] of hostStates.entries()) {
        if (await calculateTabTime(hostname, now, !!state.isActive, blockedUrls)) isChanged = true;
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
    
    const isTimeActive = isFrictionTime(items.schedule);
    const shouldApplyFilter = isBlocked && isTimeActive;

    try {
        await chrome.tabs.sendMessage(tabId, {
            isBlocked: shouldApplyFilter,
            filters: mergeFilterSettings(items.filterSettings),
        });
    } catch (e) {
        // 탭이 아직 로드되지 않았거나 닫힌 경우 무시
    }

    if (shouldApplyFilter) {
        maybeTriggerNudge(tabId, url).catch(() => {});
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
    
    const isCurrentlyActive = isFrictionTime(items.schedule);
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
        if (lastActiveTabId !== null) {
            try {
                const tab = await chrome.tabs.get(lastActiveTabId);
                if (tab?.url) await maybeTriggerNudge(lastActiveTabId, tab.url);
            } catch (e) {
                // ignore
            }
        }
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
        "DEBUG_RESET_STATS",
        "DEBUG_FORCE_SAVE",
        "DEBUG_TRACK_NOW",
        "NUDGE_ACK",
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

    if (request.action === "DEBUG_RESET_STATS") {
        loadStatsCache()
            .then(async () => {
                statsCache = { dates: {} };
                cacheLoaded = true;
                await chrome.storage.local.set({ stats: statsCache });
                sendResponse({ success: true });
            })
            .catch((e) => {
                console.error("DEBUG_RESET_STATS failed:", e);
                sendResponse({ success: false });
            });
        return true;
    }

    if (request.action === "NUDGE_ACK") {
        const hostname = typeof request.hostname === 'string' ? request.hostname : '';
        const dateStr = typeof request.dateStr === 'string' ? request.dateStr : getLocalDateStr();
        if (hostname) {
            const key = getNudgeDayKey(dateStr, hostname);
            markNudgeAck(key).catch(() => {});
        }
        sendResponse({ success: true });
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
        const isForegroundActive =
            focusedWindowId !== null ? (tab.active && tab.windowId === focusedWindowId) : false;
        await sendFrictionMessage(tabId, tab.url);
        await settleTabTime(tab.url, isForegroundActive, true);
        if (isForegroundActive) {
            await maybeTriggerNudge(tabId, tab.url);
        }
    }
});

// 탭 활성화 (✨ 이전 탭 정산 추가)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (focusedWindowId !== null && activeInfo.windowId !== focusedWindowId) return;
    if (activeInfo.tabId === lastActiveTabId) return;
    const now = Date.now();
    // 1. 이전 활성 탭의 시간을 먼저 정산
    await settlePreviousTab(now);
    
    // 2. 새로운 활성 탭 처리
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url) {
            await sendFrictionMessage(tab.id, tab.url);
            await settleTabTime(tab.url, false, false, now);
            lastActiveTabId = activeInfo.tabId;
            await maybeTriggerNudge(tab.id, tab.url);
        }
    } catch (e) {
        console.error("Error handling tab activation:", e);
    }
});

// 브라우저 포커스 변경 (✨ async로 변경)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        const now = Date.now();
        await settlePreviousTab(now);
        focusedWindowId = windowId;
        try {
            const window = await chrome.windows.get(windowId, { populate: true });
            const activeTab = window.tabs.find(t => t.active);
            if (activeTab && activeTab.url) {
                await sendFrictionMessage(activeTab.id, activeTab.url);
                await settleTabTime(activeTab.url, false, false, now);
                lastActiveTabId = activeTab.id;
                await maybeTriggerNudge(activeTab.id, activeTab.url);
            }
        } catch (e) {
            console.error("Error handling window focus:", e);
        }
    } else {
        // 포커스 상실 시
        const now = Date.now();
        await settlePreviousTab(now);
        focusedWindowId = null;
        lastActiveTabId = null;
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
        const win = await chrome.windows.getLastFocused({ populate: true });
        if (win && win.id !== chrome.windows.WINDOW_ID_NONE) {
            focusedWindowId = win.id;
            const activeTab = win.tabs && Array.isArray(win.tabs) ? win.tabs.find(t => t.active) : null;
            if (activeTab) lastActiveTabId = activeTab.id;
        }
    } catch (e) {
        console.error("Error initializing active tab:", e);
    }
})();
