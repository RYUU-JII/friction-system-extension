import { CONFIG_DEFAULT_FILTER_SETTINGS } from './config.js';
import { isFrictionTime, getLocalDateStr, ensureNumber, getHostname } from './utils/utils.js';
import { calculateAnxietyScore, getInterventionLevel } from './AnxietyEngine.js';

const DEFAULT_FILTER_SETTINGS = CONFIG_DEFAULT_FILTER_SETTINGS;
const SHORT_DWELL_THRESHOLD = 10 * 1000; 
const MAX_WINDOW_SIZE = 5;

let anxietyBuffer = {
    min1: createEmptyMetrics()
};

let hourlyAnxietyAccumulator = createEmptyMetrics(); 
let activeMinutesInHour = 0; 
let lastHourlyRecordTime = Date.now();
let anxietyWindow = []; 

let tabEntryTimes = new Map(); 

function createEmptyMetrics() {
    return {
        clicks: 0, scrollSpikes: 0, dragCount: 0, backspaces: 0,
        dwellTime: 0, backHistory: 0, tabSwitches: 0, domLoops: 0,
        tabBursts: 0, videoSkips: 0, mediaDensity: 0
    };
}

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

// [보완] statsCache 초기 구조에 엔진 상태 포함
let statsCache = { 
    dates: {},
    engineState: { // 서비스 워커 종료 대비용
        hourlyAccumulator: createEmptyMetrics(),
        activeMinutes: 0,
        lastRecordTime: Date.now(),
        window: [] 
    }
};
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
        // 두 개의 키를 명시적으로 요청
        const data = await chrome.storage.local.get(['stats', 'engineState']);
        
        // 1. 통계 데이터 복구
        if (data.stats && data.stats.dates) {
            statsCache = data.stats;
        }

        // 2. 엔진 상태 복구 (가장 중요한 부분)
        if (data.engineState) {
            const es = data.engineState;
            hourlyAnxietyAccumulator = es.hourlyAccumulator || createEmptyMetrics();
            activeMinutesInHour = es.activeMinutes || 0;
            lastHourlyRecordTime = es.lastRecordTime || Date.now();
            anxietyWindow = es.window || [];
        }
        
        pruneOldData(); // 오래된 날짜 데이터 정리
        cacheLoaded = true;
    } catch (e) {
        console.error("Failed to load stats:", e);
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

async function saveStatsCache() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }

    // 엔진 상태 스냅샷 생성
    const engineSnapshot = {
        hourlyAccumulator: hourlyAnxietyAccumulator,
        activeMinutes: activeMinutesInHour,
        lastRecordTime: lastHourlyRecordTime,
        window: anxietyWindow
    };

    // 저장소에는 두 개의 독립적인 키로 저장
    const dataToSave = {
        stats: statsCache,      // dates: { ... }
        engineState: engineSnapshot // accumulator, window 등
    };

    try {
        await chrome.storage.local.set(dataToSave);
    } catch (e) {
        console.error("Failed to save stats:", e);
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
// 5. 이벤트 리스너
// ===========================================================

// 1분 알람: 기존 통계 저장 + 불안도 엔진 프로세싱
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'oneMinuteTick') {
        const now = Date.now();
        const dateStr = getLocalDateStr(now);

        console.group('1분 통합 정산 (${new Date(now).toLocaleTimeString()})');

        // 각 로직을 독립적으로 보호
        try { await processAnxietyTick(dateStr); } catch (e) { console.error("불안엔진 에러:", e); }
        try { await trackAllTabsBatch(); } catch (e) { console.error("탭추적 에러:", e); }
        try { await checkScheduleStatus(); } catch (e) { console.error("스케줄체크 에러:", e); }

        // 넛지 로직 (마지막 활성 탭 기준)
        if (lastActiveTabId !== null) {
            try {
                const tab = await chrome.tabs.get(lastActiveTabId);
                if (tab?.url) await maybeTriggerNudge(lastActiveTabId, tab.url);
            } catch (e) { /* 무시 */ }
        }

        console.groupEnd();
    }
});

// 메시지 수신 통합 핸들러
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request || typeof request.action !== 'string' && !request.type) return false;

    // 1. [NEW] ContentScript로부터의 불안도 지표 수집
    if (request.type === "TRACK_ANXIETY") {
        const metric = request.metric;
        if (anxietyBuffer.min1 && anxietyBuffer.min1[metric] !== undefined) {
            anxietyBuffer.min1[metric]++;
        }
        return false; 
    }

    // 2. 기존 디버그 및 설정 관련 액션들
    const knownActions = new Set([
        "SETTINGS_UPDATED", "SCHEDULE_UPDATED", "DEBUG_GET_CACHE",
        "DEBUG_RESET_STATS", "DEBUG_FORCE_SAVE", "DEBUG_TRACK_NOW", "NUDGE_ACK"
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

    return true; 
});

// 탭 업데이트: 도메인 이동 및 로드 완료 감지
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // 1. 도메인 이동/페이지 전환 시작 시 (이전 페이지 짧은 체류 정산)
    if (changeInfo.status === 'loading' && tab.url) {
        if (tabEntryTimes.has(tabId)) {
            const stayDuration = Date.now() - tabEntryTimes.get(tabId);
            if (stayDuration < SHORT_DWELL_THRESHOLD) {
                if (anxietyBuffer.min1) anxietyBuffer.min1.dwellTime++;
            }
            tabEntryTimes.delete(tabId);
        }
        if (anxietyBuffer.min1) anxietyBuffer.min1.pageLoads++;
    }

    // 2. 페이지 로드 완료 (새 기준점 기록)
    if (changeInfo.status === 'complete' && tab.url) {
        tabEntryTimes.set(tabId, Date.now());

        const isForegroundActive = focusedWindowId !== null ? (tab.active && tab.windowId === focusedWindowId) : false;
        await sendFrictionMessage(tabId, tab.url);
        await settleTabTime(tab.url, isForegroundActive, true);
        
        if (isForegroundActive) {
            lastActiveTabId = tabId;
            await maybeTriggerNudge(tabId, tab.url);
        }
    }
});

// 탭 생성: 탭 폭주 감지
chrome.tabs.onCreated.addListener(() => {
    if (anxietyBuffer.min1) anxietyBuffer.min1.tabBursts++; 
});

// 탭 활성화 변경: 탭 저글링(짧은 전환) 감지
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (focusedWindowId !== null && activeInfo.windowId !== focusedWindowId) return;
    if (activeInfo.tabId === lastActiveTabId) return;

    const now = Date.now();

    // [불안도] 이전 탭의 체류 시간 확인
    if (lastActiveTabId && tabEntryTimes.has(lastActiveTabId)) {
        const stayDuration = now - tabEntryTimes.get(lastActiveTabId);
        if (stayDuration < SHORT_DWELL_THRESHOLD) {
            if (anxietyBuffer.min1) anxietyBuffer.min1.dwellTime++;
        }
    }
    if (anxietyBuffer.min1) anxietyBuffer.min1.tabSwitches++;

    // 기존 시간 정산 로직
    await settlePreviousTab(now);
    
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url) {
            tabEntryTimes.set(activeInfo.tabId, now); // 진입 시간 갱신
            await sendFrictionMessage(tab.id, tab.url);
            await settleTabTime(tab.url, false, false, now);
            lastActiveTabId = activeInfo.tabId;
            await maybeTriggerNudge(tab.id, tab.url);
        }
    } catch (e) { console.error(e); }
});

// 탭 삭제
chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabEntryTimes.has(tabId)) {
        const stayDuration = Date.now() - tabEntryTimes.get(tabId);
        if (stayDuration < SHORT_DWELL_THRESHOLD) {
            if (anxietyBuffer.min1) anxietyBuffer.min1.dwellTime++;
        }
        tabEntryTimes.delete(tabId);
    }
});

// ===========================================================
// [NEW] 불안도 엔진 핵심 함수
// ===========================================================

/**
 * 1분마다 실행되는 데이터 정산 함수 (보강 버전)
 */
async function processAnxietyTick(dateStr) {
    await loadStatsCache(); // 안전장치

    const now = new Date();
    const currentMinMetrics = { ...anxietyBuffer.min1 };
    
    // [엔진 가동] 점수 계산
    const score = calculateAnxietyScore(currentMinMetrics);
    const level = getInterventionLevel(score);

    // 2. [강력 추천] 진단용 로그 추가
    console.group(`📊 Anxiety Engine Report (${new Date().toLocaleTimeString()})`);
    console.log("1단계 - 수집된 지표:", currentMinMetrics);
    console.log("2단계 - 계산된 불안 점수:", score, "/ 100");
    console.log("3단계 - 개입 레벨:", level);
    console.log("4단계 - 5분 윈도우 상태:", anxietyWindow.length, "mins stored");
    console.log("5단계 - 현재 시간 누적 사용:", activeMinutesInHour, "mins");
    console.groupEnd();

    // [윈도우 업데이트] 5분 전조 증상 기록용
    anxietyWindow.push({ t: now.getTime(), m: currentMinMetrics, s: score });
    if (anxietyWindow.length > MAX_WINDOW_SIZE) anxietyWindow.shift();

    // [시간 통계 누적]
    for (const key in currentMinMetrics) {
        hourlyAnxietyAccumulator[key] += currentMinMetrics[key];
    }
    activeMinutesInHour++;

    // [정시 마감 및 누락 체크]
    if (now.getMinutes() === 0 || (now.getTime() - lastHourlyRecordTime > 3600000)) {
        await saveHourlyAnxietyStats(dateStr, now.getHours());
        lastHourlyRecordTime = now.getTime();
    }

    // [이벤트 트리거] 사용자 시인이 없어도 시스템이 위험 감지 시 자동 저장
    if (level === 'CRITICAL') {
        await saveAnxietyEventToStorage(dateStr, "SYSTEM_AUTO_DETECT");
        applyFriction(level); // 개입 로직 호출
    }

    anxietyBuffer.min1 = createEmptyMetrics();
    await saveStatsCache(); // 엔진 상태 영구 저장
    console.log("💾 엔진 상태가 로컬 스토리지에 동기화되었습니다.");
}

/**
 * 정시마다 1시간 통계를 저장하는 함수
 */
async function saveHourlyAnxietyStats(dateStr, hour) {
    if (activeMinutesInHour === 0) return; // 데이터가 아예 없으면 기록 안 함

    if (!statsCache.dates[dateStr]) statsCache.dates[dateStr] = { domains: {} };
    if (!statsCache.dates[dateStr].hourlyAnxiety) statsCache.dates[dateStr].hourlyAnxiety = {};

    // [보정 로직] 60분 기준 가중치 계산
    // 만약 30분만 사용했다면, 수집된 지표를 2배(60/30)로 보정하여 '밀도'를 산출
    const normalizationFactor = 60 / activeMinutesInHour;
    
    const normalizedMetrics = {};
    for (const key in hourlyAnxietyAccumulator) {
        normalizedMetrics[key] = hourlyAnxietyAccumulator[key] * normalizationFactor;
    }

    statsCache.dates[dateStr].hourlyAnxiety[hour] = {
        rawMetrics: { ...hourlyAnxietyAccumulator }, // 실제 수집량
        normalizedMetrics: normalizedMetrics,        // 60분 환산 수치
        activeMinutes: activeMinutesInHour,          // 실제 사용 시간 (분)
        avgScore: calculateAnxietyScore(normalizedMetrics) // 보정된 점수
    };

    // 초기화
    hourlyAnxietyAccumulator = createEmptyMetrics();
    activeMinutesInHour = 0;
    
    await saveStatsCache();
    console.log(`[Stats] Hour ${hour} saved. Active: ${activeMinutesInHour}m. Normalized.`);
}

/**
 * 불안 확정 시 5분치 데이터를 상세 저장하는 함수 (타임스탬프 보강)
 */
async function saveAnxietyEventToStorage(dateStr, triggerSource) {
    if (anxietyWindow.length === 0) return;

    if (!statsCache.dates[dateStr]) statsCache.dates[dateStr] = { domains: {} };
    if (!statsCache.dates[dateStr].anxietyEvents) statsCache.dates[dateStr].anxietyEvents = [];

    statsCache.dates[dateStr].anxietyEvents.push({
        eventTimestamp: Date.now(), // 이벤트 발생 시점
        trigger: triggerSource,
        // history 내부 각 항목에 이미 t(시각)가 포함되어 있음
        history: JSON.parse(JSON.stringify(anxietyWindow)) 
    });

    await saveStatsCache();
}

function applyFriction(level) {
    console.warn(`[Intervention] Level: ${level} - 사용자의 불안이 감지되었습니다.`);
    // TODO: contentScript로 메시지를 보내 안개 필터 농도를 조절하거나 넛지를 띄움
}