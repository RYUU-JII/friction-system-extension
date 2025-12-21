import { CONFIG_DEFAULT_FILTER_SETTINGS } from './config.js';
import { isFrictionTime, getLocalDateStr, ensureNumber, getHostname } from './utils/utils.js';
import { calculateAnxietyScore, getInterventionLevel } from './AnxietyEngine.js';

// ===========================================================
// 0. 상수 및 전역 변수 설정
// ===========================================================

const DEFAULT_FILTER_SETTINGS = CONFIG_DEFAULT_FILTER_SETTINGS;
const SHORT_DWELL_THRESHOLD = 10 * 1000; 
const MAX_WINDOW_SIZE = 5;

// [불안 엔진 변수]
let anxietyBuffer = { min1: createEmptyMetrics() };
let hourlyAnxietyAccumulator = createEmptyMetrics(); 
let activeMinutesInHour = 0; 
let lastHourlyRecordTime = Date.now();
let anxietyWindow = []; 
let tabEntryTimes = new Map(); 

// [시간 추적 변수]
let statsCache = { dates: {} };
let cacheLoaded = false;
let saveTimer = null;
let savePending = null;
let idleState = 'active';
let lastIdleStateCheck = 0;
let lastActiveTabId = null;  // 현재 활성 탭 ID
let focusedWindowId = null;  // 현재 포커스된 윈도우 ID (매우 중요)

const TRACKING_INTERVAL_MS = 60_000; // 1 minute
const LONG_GAP_LIMIT_MS = TRACKING_INTERVAL_MS * 2;
const MAX_DAYS_STORED = 30;
const IDLE_DETECTION_SECONDS = 60;
const IDLE_STATE_CACHE_TTL_MS = 10_000;
const CACHE_SAVE_INTERVAL_MS = 300000; // 5분 강제 저장

// 5분마다 강제 저장 (데이터 유실 방지 안전장치)
setInterval(() => {
    saveStatsCache();
}, CACHE_SAVE_INTERVAL_MS);

// ===========================================================
// 1. 유틸리티 및 설정 함수
// ===========================================================

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

function ensureAlarm() {
    chrome.alarms.get('oneMinuteTick', (alarm) => {
        if (!alarm) {
            chrome.alarms.create('oneMinuteTick', { periodInMinutes: 1 });
            console.log("⏰ 알람이 생성되었습니다: oneMinuteTick");
        }
    });
}

function setupIdleDetection() {
    if (!chrome.idle) return;
    try { chrome.idle.setDetectionInterval(IDLE_DETECTION_SECONDS); } catch (_) {}

    chrome.idle.onStateChanged.addListener((state) => {
        idleState = state || idleState;
        lastIdleStateCheck = Date.now();
    });

    chrome.idle.queryState(IDLE_DETECTION_SECONDS, (state) => {
        if (chrome.runtime.lastError) return;
        idleState = state || idleState;
        lastIdleStateCheck = Date.now();
    });
}

function getIdleState() {
    if (!chrome.idle) return Promise.resolve('active');
    const now = Date.now();
    if (now - lastIdleStateCheck < IDLE_STATE_CACHE_TTL_MS) return Promise.resolve(idleState);
    lastIdleStateCheck = now;
    return new Promise((resolve) => {
        chrome.idle.queryState(IDLE_DETECTION_SECONDS, (state) => {
            if (chrome.runtime.lastError) return resolve(idleState);
            idleState = state || idleState;
            resolve(idleState);
        });
    });
}

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
    if (source.socialMetrics?.isActive) {
        if (!source.socialEngagement) merged.socialEngagement.isActive = true;
        if (!source.socialExposure) merged.socialExposure.isActive = true;
    }
    return merged;
}

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

// ... (isNudgeShown, markNudgeShown, markNudgeAck 기존 동일) ...
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

// ===========================================================
// 2. 데이터 저장 및 복구 (Engine + Stats 통합)
// ===========================================================

// 디바운스 저장: 빈번한 연산에도 스토리지는 가끔만 씀 (시스템 부하 최소화)
function saveStatsDebounced() {
    if (savePending) clearTimeout(savePending);
    savePending = setTimeout(() => {
        saveStatsCache();
        savePending = null;
    }, 1000); // 1초 딜레이
}

async function loadStatsCache() {
    if (cacheLoaded) return;
    try {
        const data = await chrome.storage.local.get(['stats', 'engineState']);
        
        // 1. Stats 복구
        if (data.stats && data.stats.dates) {
            statsCache = data.stats;
        }

        // 2. Engine State 복구
        if (data.engineState) {
            const es = data.engineState;
            hourlyAnxietyAccumulator = es.hourlyAccumulator || createEmptyMetrics();
            activeMinutesInHour = es.activeMinutes || 0;
            lastHourlyRecordTime = es.lastRecordTime || Date.now();
            anxietyWindow = es.window || [];
        }
        
        pruneOldData();
        cacheLoaded = true;
    } catch (e) {
        console.error("Failed to load stats:", e);
        cacheLoaded = true;
    }
}

async function saveStatsCache() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }

    const engineSnapshot = {
        hourlyAccumulator: hourlyAnxietyAccumulator,
        activeMinutes: activeMinutesInHour,
        lastRecordTime: lastHourlyRecordTime,
        window: anxietyWindow
    };

    const dataToSave = {
        stats: statsCache,
        engineState: engineSnapshot
    };

    try {
        await chrome.storage.local.set(dataToSave);
    } catch (e) {
        console.error("Failed to save stats:", e);
    }
}

function ensureHourlyArrays(domainData) {
    if (!domainData || typeof domainData !== 'object') return;
    const normalize24 = (val) => {
        const arr = Array(24).fill(0);
        if (!val) return arr;
        if (Array.isArray(val)) {
            for (let i = 0; i < 24; i++) arr[i] = ensureNumber(val[i]);
            return arr;
        }
        return arr;
    };
    if (!Array.isArray(domainData.hourly)) domainData.hourly = normalize24(domainData.hourly);
    if (!Array.isArray(domainData.hourlyActive)) domainData.hourlyActive = normalize24(domainData.hourlyActive);
    if (!Array.isArray(domainData.hourlyBackground)) domainData.hourlyBackground = normalize24(domainData.hourlyBackground);
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

function pruneOldData() {
    if (!statsCache.dates) { statsCache.dates = {}; return; }
    const dates = Object.keys(statsCache.dates);
    if (dates.length <= MAX_DAYS_STORED) return;
    dates.sort();
    for (let i = 0; i < dates.length - MAX_DAYS_STORED; i++) {
        delete statsCache.dates[dates[i]];
    }
}

// ===========================================================
// 3. 시간 계산 핵심 로직 (정확도 복원)
// ===========================================================

// 단일 도메인의 시간을 계산하고 캐시에 반영
async function calculateTabTime(hostname, now, isActive, blockedUrlsOverride = null) {
    const dateStr = getLocalDateStr(now);
    
    if (!statsCache.dates[dateStr]) {
        statsCache.dates[dateStr] = { domains: {}, totals: { totalActive: 0, totalBackground: 0, blockedActive: 0, blockedBackground: 0 } };
    }

    const dateData = statsCache.dates[dateStr];
    if (!dateData.domains[hostname]) {
        dateData.domains[hostname] = { 
            active: 0, background: 0, visits: 0, 
            hourly: Array(24).fill(0), hourlyActive: Array(24).fill(0), hourlyBackground: Array(24).fill(0), 
            lastTrackedTime: now 
        };
        return true;
    }

    const domainData = dateData.domains[hostname];
    ensureHourlyArrays(domainData);
    const lastTime = ensureNumber(domainData.lastTrackedTime);
    
    // 초기화 직후이거나 시간이 역행한 경우
    if (lastTime === 0 || lastTime > now) {
        domainData.lastTrackedTime = now;
        return true;
    }

    let elapsed = now - lastTime;
    if (elapsed > LONG_GAP_LIMIT_MS) {
        domainData.lastTrackedTime = now;
        return true;
    }

    const idleStateNow = await getIdleState();
    if (idleStateNow !== 'active') {
        if (domainData.lastTrackedTime !== now) {
            domainData.lastTrackedTime = now;
            return true;
        }
        return false;
    }

    // Ignore tiny gaps to reduce noise.
    if (elapsed < 100) return false;

    const timeType = isActive ? 'active' : 'background';
    domainData[timeType] += elapsed;
    // Keep hourly buckets aligned with the recorded elapsed window.
    const effectiveStart = now - elapsed;
    addElapsedToHourly(domainData, effectiveStart, now, isActive);
    
    // 타임스탬프 갱신 (중요: 이 시점까지 정산 완료됨을 의미)
    domainData.lastTrackedTime = now;

    // 총계 업데이트
    dateData.totals[`total${timeType.charAt(0).toUpperCase() + timeType.slice(1)}`] += elapsed;

    // 차단 사이트 체크
    const blockedUrls = Array.isArray(blockedUrlsOverride)
        ? blockedUrlsOverride
        : ((await chrome.storage.local.get('blockedUrls')).blockedUrls || []);
    if (blockedUrls.includes(hostname)) {
        dateData.totals[`blocked${timeType.charAt(0).toUpperCase() + timeType.slice(1)}`] += elapsed;
    }

    return true;
}

// 특정 URL에 대해 시간 정산 트리거
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
    
    if (isChanged) saveStatsDebounced();
}

// 현재 활성 탭의 시간을 강제로 정산 (탭 전환, 창 전환 시 호출)
async function settlePreviousTab(nowOverride = null) {
    if (lastActiveTabId === null) return;
    try {
        const tab = await chrome.tabs.get(lastActiveTabId);
        if (tab && tab.url) {
            // 이 탭은 지금까지 'Active' 였음이 확실함
            await settleTabTime(tab.url, true, false, nowOverride);
        }
    } catch (e) { /* 탭이 이미 닫힘 */ }
}

// 1분 주기 배치 처리 (모든 탭의 lastTrackedTime을 현 시간으로 끌어올림)
async function trackAllTabsBatch() {
    await loadStatsCache();
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    let isChanged = false;
    const items = await chrome.storage.local.get('blockedUrls');
    
    // 현재 포커스된 창이 없으면 모두 비활성으로 간주
    const isWindowFocused = focusedWindowId !== null && focusedWindowId !== chrome.windows.WINDOW_ID_NONE;

    for (const tab of tabs) {
        const hostname = getHostname(tab.url);
        if (!hostname || tab.url.startsWith('chrome://')) continue;

        // 현재 탭이 활성 상태인지 판단
        const isTabActive = isWindowFocused && tab.active && (tab.windowId === focusedWindowId);
        
        if (await calculateTabTime(hostname, now, isTabActive, items.blockedUrls)) {
            isChanged = true;
        }
    }
    
    if (isChanged) saveStatsDebounced();
}

// ... (maybeTriggerNudge, sendFrictionMessage 등 기존 동일) ...
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
            payload: { hostname, dateStr, config, reason: force ? 'debug' : 'threshold' },
        });
        await markNudgeShown(key);
    } catch (e) {}
}

async function sendFrictionMessage(tabId, url) {
    if (!url || url.startsWith('chrome://')) return;
    const items = await chrome.storage.local.get({
        blockedUrls: [], filterSettings: DEFAULT_FILTER_SETTINGS, schedule: { scheduleActive: false }
    });
    const hostname = getHostname(url);
    const shouldApply = hostname && items.blockedUrls.includes(hostname) && isFrictionTime(items.schedule);

    try {
        await chrome.tabs.sendMessage(tabId, {
            isBlocked: shouldApply,
            filters: mergeFilterSettings(items.filterSettings),
        });
    } catch (e) {}

    if (shouldApply) maybeTriggerNudge(tabId, url).catch(()=>{});
}

async function broadcastSettingsUpdate() {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) if (tab.url) await sendFrictionMessage(tab.id, tab.url);
}

async function checkScheduleStatus() {
    const items = await chrome.storage.local.get({ schedule: { scheduleActive: false } });
    const isCurrentlyActive = isFrictionTime(items.schedule);
    const session = await chrome.storage.session.get('lastScheduleState');
    if (session.lastScheduleState !== isCurrentlyActive) {
        await chrome.storage.session.set({ lastScheduleState: isCurrentlyActive });
        await broadcastSettingsUpdate();
    }
}

// ===========================================================
// 4. 이벤트 리스너 (정확도 핵심)
// ===========================================================

// [1] 통합 알람 (심장 박동)
chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'oneMinuteTick') {
        const now = Date.now();
        const dateStr = getLocalDateStr(now);

        console.group('💓 1분 통합 정산 (${new Date(now).toLocaleTimeString()})');
        
        // 1. 불안 엔진 처리
        try { await processAnxietyTick(dateStr); } catch (e) { console.error("AnxietyTick Error:", e); }
        
        // 2. 시간 추적 배치 처리
        try { await trackAllTabsBatch(); } catch (e) { console.error("TrackBatch Error:", e); }
        
        // 3. 스케줄 및 넛지
        try { await checkScheduleStatus(); } catch (e) { /* ignore */ }
        
        if (lastActiveTabId !== null) {
            try {
                const tab = await chrome.tabs.get(lastActiveTabId);
                if (tab?.url) await maybeTriggerNudge(lastActiveTabId, tab.url);
            } catch (e) {}
        }
        console.groupEnd();
    }
});

// [2] 탭 활성화 (사용자가 탭을 클릭함)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const now = Date.now();
    
    // 1. 이전 탭 시간 정산 (아주 중요)
    await settlePreviousTab(now);

    // 2. 윈도우 포커스 확인
    if (focusedWindowId !== null && activeInfo.windowId !== focusedWindowId) {
        // 다른 윈도우의 탭을 클릭했더라도, 포커스 ID를 맞춰줌
        focusedWindowId = activeInfo.windowId;
    }

    // 3. 불안 엔진 지표 수집
    if (activeInfo.tabId !== lastActiveTabId) {
        if (lastActiveTabId && tabEntryTimes.has(lastActiveTabId)) {
            const stayDuration = now - tabEntryTimes.get(lastActiveTabId);
            if (stayDuration < SHORT_DWELL_THRESHOLD) {
                if (anxietyBuffer.min1) anxietyBuffer.min1.dwellTime++;
            }
        }
        if (anxietyBuffer.min1) anxietyBuffer.min1.tabSwitches++;
    }

    // 4. 새 탭 추적 시작
    lastActiveTabId = activeInfo.tabId;
    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url) {
            tabEntryTimes.set(activeInfo.tabId, now);
            await sendFrictionMessage(tab.id, tab.url);
            // 진입 시점 기록 (isNewVisit=false, 단순 전환)
            await settleTabTime(tab.url, false, false, now); 
            await maybeTriggerNudge(tab.id, tab.url);
        }
    } catch (e) {}
});

// [3] 윈도우 포커스 변경 (이게 빠져서 그동안 정확도가 낮았음)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    const now = Date.now();
    
    // 1. 포커스 잃기 전 탭 정산
    await settlePreviousTab(now);

    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        // 브라우저가 포커스를 잃음 (다른 앱 사용 중)
        focusedWindowId = null;
        // lastActiveTabId는 null로 만들지 않음 (돌아왔을 때 대비)
        // 대신 trackAllTabsBatch에서 focusedWindowId가 null이면 active 계산을 안 함
    } else {
        // 브라우저로 돌아옴
        focusedWindowId = windowId;
        try {
            const win = await chrome.windows.get(windowId, { populate: true });
            const activeTab = win.tabs.find(t => t.active);
            if (activeTab) {
                lastActiveTabId = activeTab.id;
                if (activeTab.url) {
                    await sendFrictionMessage(activeTab.id, activeTab.url);
                    await settleTabTime(activeTab.url, true, false, now); // Active 상태로 기록 재개
                    await maybeTriggerNudge(activeTab.id, activeTab.url);
                }
            }
        } catch (e) { console.error(e); }
    }
});

// [4] 탭 업데이트 (URL 변경 등)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    // 로딩 시작 시 체류시간 체크
    if (changeInfo.status === 'loading' && tab.url) {
        if (tabEntryTimes.has(tabId)) {
            const stayDuration = Date.now() - tabEntryTimes.get(tabId);
            if (stayDuration < SHORT_DWELL_THRESHOLD && anxietyBuffer.min1) {
                anxietyBuffer.min1.dwellTime++;
            }
            tabEntryTimes.delete(tabId);
        }
        if (anxietyBuffer.min1) anxietyBuffer.min1.pageLoads++;
    }

    // 로딩 완료 시 시간 추적 시작
    if (changeInfo.status === 'complete' && tab.url) {
        tabEntryTimes.set(tabId, Date.now());
        const isForegroundActive = focusedWindowId !== null ? (tab.active && tab.windowId === focusedWindowId) : false;
        
        await sendFrictionMessage(tabId, tab.url);
        await settleTabTime(tab.url, isForegroundActive, true); // isNewVisit=true
        
        if (isForegroundActive) {
            lastActiveTabId = tabId;
            await maybeTriggerNudge(tabId, tab.url);
        }
    }
});

// [5] 탭 닫힘
chrome.tabs.onRemoved.addListener((tabId) => {
    // 체류 시간 체크
    if (tabEntryTimes.has(tabId)) {
        const stayDuration = Date.now() - tabEntryTimes.get(tabId);
        if (stayDuration < SHORT_DWELL_THRESHOLD && anxietyBuffer.min1) {
            anxietyBuffer.min1.dwellTime++;
        }
        tabEntryTimes.delete(tabId);
    }
    // 닫힌 탭이 활성 탭이었다면? 
    // 이미 onActivated(다른 탭)나 onFocusChanged가 처리했을 가능성이 높음
});

// [6] 메시지 핸들러
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request) return false;

    // 1. 불안도 지표 수집 (즉시 처리)
    if (request.type === "TRACK_ANXIETY") {
        const metric = request.metric;
        if (anxietyBuffer.min1 && anxietyBuffer.min1[metric] !== undefined) {
            anxietyBuffer.min1[metric]++;
        }
        // 응답이 필요 없는 단순 수집이므로 false
        return false; 
    }

    const action = request.action || request.type;

    // 2. 디버그용: 현재 캐시 데이터 확인 (즉시 응답)
    if (action === "DEBUG_GET_CACHE") {
        sendResponse({ 
            cache: statsCache, 
            loaded: cacheLoaded, 
            lastActiveTab: lastActiveTabId, 
            focusedWin: focusedWindowId 
        });
        return false;
    }

    // 3. 디버그용: 통계 초기화 (비동기 처리)
    if (action === "DEBUG_RESET_STATS") {
        loadStatsCache().then(async () => {
            statsCache = { dates: {} };
            await chrome.storage.local.set({ stats: statsCache });
            sendResponse({ success: true });
        }).catch(err => sendResponse({ success: false, error: err.message }));
        return true; // async 응답 대기
    }

    // 4. 디버그용: 강제 저장 (비동기 처리)
    if (action === "DEBUG_FORCE_SAVE") {
        saveStatsCache().then(() => sendResponse({ success: true }));
        return true;
    }

    // 5. 넛지 확인 처리 (NUDGE_ACK)
    if (action === "NUDGE_ACK") {
        const key = request.key;
        if (key) {
            markNudgeAck(key).then(() => sendResponse({ success: true }));
            return true;
        }
        sendResponse({ success: false });
        return false;
    }

    // 6. 대시보드 데이터 요청 (DASHBOARD 연동 시 필수)
    if (action === "GET_DASHBOARD_DATA") {
        loadStatsCache().then(() => {
            sendResponse({ 
                success: true, 
                stats: statsCache, 
                engine: {
                    currentScore: anxietyWindow.length > 0 ? anxietyWindow[anxietyWindow.length-1].s : 0,
                    activeMinutes: activeMinutesInHour
                }
            });
        });
        return true;
    }

    // 7. 차단 설정 업데이트 브로드캐스트 요청
    if (action === "REFRESH_SETTINGS") {
        broadcastSettingsUpdate().then(() => sendResponse({ success: true }));
        return true;
    }

    // 정의되지 않은 액션이 들어온 경우 채널을 닫아줌
    return false;
});

// ===========================================================
// 5. 불안 엔진 (Anxiety Engine) - 수정됨
// ===========================================================

async function processAnxietyTick(dateStr) {
    await loadStatsCache();

    const now = new Date();
    const currentMinMetrics = { ...anxietyBuffer.min1 };
    
    const score = calculateAnxietyScore(currentMinMetrics);
    const level = getInterventionLevel(score);

    console.groupCollapsed(`🧠 Anxiety Engine: Score ${score} (${level})`);
    console.log("Metrics:", currentMinMetrics);
    console.groupEnd();

    anxietyWindow.push({ t: now.getTime(), m: currentMinMetrics, s: score });
    if (anxietyWindow.length > MAX_WINDOW_SIZE) anxietyWindow.shift();

    for (const key in currentMinMetrics) {
        hourlyAnxietyAccumulator[key] += currentMinMetrics[key];
    }
    
    // [중요] 실제 활성 시간은 여기서 단순 ++ 하지 않고, 
    // trackAllTabsBatch 결과나 별도 로직으로 보정할 수도 있지만, 
    // 일단 엔진 자체의 '가동 시간'으로 보고 유지합니다.
    activeMinutesInHour++;

    if (now.getMinutes() === 0 || (now.getTime() - lastHourlyRecordTime > 3600000)) {
        await saveHourlyAnxietyStats(dateStr, now.getHours());
        lastHourlyRecordTime = now.getTime();
    }

    if (level === 'CRITICAL') {
        await saveAnxietyEventToStorage(dateStr, "SYSTEM_AUTO_DETECT");
        applyFriction(level);
    }

    anxietyBuffer.min1 = createEmptyMetrics();
    // saveStatsCache는 trackAllTabsBatch 이후에 어차피 호출되므로 여기서 굳이 중복 호출 안 해도 됨
}

async function saveHourlyAnxietyStats(dateStr, hour) {
    if (activeMinutesInHour === 0) return;
    if (!statsCache.dates[dateStr]) statsCache.dates[dateStr] = { domains: {} };
    if (!statsCache.dates[dateStr].hourlyAnxiety) statsCache.dates[dateStr].hourlyAnxiety = {};

    const normalizationFactor = 60 / activeMinutesInHour;
    const normalizedMetrics = {};
    for (const key in hourlyAnxietyAccumulator) {
        normalizedMetrics[key] = hourlyAnxietyAccumulator[key] * normalizationFactor;
    }

    statsCache.dates[dateStr].hourlyAnxiety[hour] = {
        rawMetrics: { ...hourlyAnxietyAccumulator },
        normalizedMetrics: normalizedMetrics,
        activeMinutes: activeMinutesInHour,
        avgScore: calculateAnxietyScore(normalizedMetrics)
    };

    hourlyAnxietyAccumulator = createEmptyMetrics();
    activeMinutesInHour = 0;
    await saveStatsCache();
}

async function saveAnxietyEventToStorage(dateStr, triggerSource) {
    if (anxietyWindow.length === 0) return;
    if (!statsCache.dates[dateStr]) statsCache.dates[dateStr] = { domains: {} };
    if (!statsCache.dates[dateStr].anxietyEvents) statsCache.dates[dateStr].anxietyEvents = [];

    statsCache.dates[dateStr].anxietyEvents.push({
        eventTimestamp: Date.now(),
        trigger: triggerSource,
        history: JSON.parse(JSON.stringify(anxietyWindow)) 
    });
    await saveStatsCache();
}

function applyFriction(level) {
    console.warn(`[Intervention] Level: ${level} - FRICTION APPLIED`);
}

// ===========================================================
// 6. 초기화 (Initialization) - 중요!
// ===========================================================

// 서비스 워커 시작 시 무조건 실행되어 현재 상태를 파악함
async function init() {
    await loadStatsCache();
    ensureAlarm();
    setupIdleDetection();

    try {
        const win = await chrome.windows.getLastFocused({ populate: true });
        if (win && win.id !== chrome.windows.WINDOW_ID_NONE) {
            focusedWindowId = win.id;
            const activeTab = win.tabs?.find(t => t.active);
            if (activeTab) {
                lastActiveTabId = activeTab.id;
                // 서비스 워커 재시작 시점부터 시간 추적 재개
                settleTabTime(activeTab.url, true, false, Date.now());
            }
        } else {
            focusedWindowId = null;
        }
    } catch (e) {
        console.log("초기 윈도우 포커스 확인 실패 (브라우저가 닫혀있을 수 있음)");
    }
}

init();
