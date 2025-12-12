import { CONFIG_DEFAULT_FILTER_SETTINGS } from './config.js';

const DEFAULT_FILTER_SETTINGS = CONFIG_DEFAULT_FILTER_SETTINGS;
const TRACKING_INTERVAL_MS = 60000; // 1분
const MAX_ELAPSED_LIMIT = TRACKING_INTERVAL_MS * 1.5;
const MAX_DAYS_STORED = 30; // 데이터 pruning

let statsCache = { dates: {} };  // 초기값을 명시적으로 설정 (가장 중요!)
let cacheLoaded = false;
let saveTimer = null;
const CACHE_SAVE_INTERVAL_MS = 600000;

// load/save cache (unchanged)
async function loadStatsCache() {
    if (cacheLoaded) return;
    try {
        const data = await chrome.storage.local.get('stats');
        
        // 데이터가 없거나, stats가 없거나, dates가 없으면 안전한 기본 구조로 초기화
        if (!data.stats || typeof data.stats !== 'object' || !data.stats.dates || typeof data.stats.dates !== 'object') {
            statsCache = { dates: {} };
        } else {
            statsCache = data.stats;
        }
        
        pruneOldData();  // 이제 안전하게 호출 가능
        cacheLoaded = true;
    } catch (e) {
        console.error("Failed to load stats cache:", e);
        statsCache = { dates: {} };  // 오류 시에도 반드시 초기화
        cacheLoaded = true;
    }
}

async function saveStatsCache() {
    if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
    }

    // statsCache가 null/undefined거나 dates가 없으면 안전한 객체로 대체
    const dataToSave = {
        stats: (statsCache && typeof statsCache === 'object' && statsCache.dates && typeof statsCache.dates === 'object')
            ? statsCache
            : { dates: {} }
    };

    try {
        await chrome.storage.local.set(dataToSave);
    } catch (e) {
        console.error("Failed to save stats cache:", e);
        // 심각한 오류라도 다음 저장 시도에는 안전한 상태 유지
        statsCache = { dates: {} };
    }
}
function scheduleCacheSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(saveStatsCache, CACHE_SAVE_INTERVAL_MS);
}

function pruneOldData() {
    // 방어 코드 추가: dates가 없거나 객체가 아니면 초기화
    if (!statsCache.dates || typeof statsCache.dates !== 'object') {
        statsCache.dates = {};
        return;
    }

    const dates = Object.keys(statsCache.dates);
    if (!Array.isArray(dates) || dates.length <= MAX_DAYS_STORED) {
        return; // 정렬 필요 없음
    }

    dates.sort(); // 날짜 문자열 정렬 (YYYY-MM-DD 형식이라 문자열 정렬 OK)

    for (let i = 0; i < dates.length - MAX_DAYS_STORED; i++) {
        delete statsCache.dates[dates[i]];
    }
}

// ===========================================================
// 2. Helpers
// ===========================================================

// Helpers (unchanged mostly)
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

// ===========================================================
// 3. 핵심 로직: 시간 계산 (메모리 상에서만 연산)
// ===========================================================

/**
 * 특정 도메인의 시간을 계산하여 stats에 반영하는 함수
 * @param {Object} stats - 전체 통계 객체 (참조 전달)
 * @param {String} hostname - 도메인
 * @param {Number} now - 현재 시간 Timestamp
 * @param {Boolean} isActive - 현재 탭이 활성 상태인지 여부
 * @returns {Boolean} - 데이터 변경 여부 (isChanged 플래그 역할)
 */
async function calculateTabTime(hostname, now, isActive) {
    const dateStr = new Date(now).toISOString().split('T')[0];
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
        dateData.domains[hostname] = { active: 0, background: 0, visits: 0, hourly: Array(24).fill(0), lastTrackedTime: now };
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
    if (elapsed < 1000) return false;

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
    if (!hostname) return;
    const now = Date.now();
    let isChanged = await calculateTabTime(hostname, now, isActive);
    if (isNewVisit) {
        const dateStr = new Date(now).toISOString().split('T')[0];
        statsCache.dates[dateStr].domains[hostname].visits += 1;
        isChanged = true;
    }
    if (isChanged) scheduleCacheSave();
}

// 1분 주기 배치 처리 (모든 탭 정산)
async function trackAllTabsBatch() {
    await loadStatsCache();
    const tabs = await chrome.tabs.query({});
    const now = Date.now();
    let isChanged = false;
    for (const tab of tabs) {
        const hostname = getHostname(tab.url);
        if (!hostname || tab.url.startsWith('chrome://')) continue;
        if (await calculateTabTime(hostname, now, tab.active)) isChanged = true;
    }
    if (isChanged) scheduleCacheSave();
}

// ===========================================================
// 4. 필터링 및 메시지 전송 (기존 로직 유지)
// ===========================================================

async function sendFrictionMessage(tabId, url) {
    if (!url || url.startsWith('chrome://')) return;

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
            filters: items.filterSettings,
        });
    } catch (e) {
        // 탭이 아직 로드되지 않았거나 닫힌 경우 무시
    }
}

async function broadcastSettingsUpdate() {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) {
        if (tab.url) sendFrictionMessage(tab.id, tab.url);
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
// 5. 이벤트 리스너
// ===========================================================

// 1분 알람 (통합 주기)
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'oneMinuteTick') {
        trackAllTabsBatch(); // 시간 정산 (이제 Storage I/O 없음)
        checkScheduleStatus(); // 스케줄 체크
    }
});

// 메시지 수신 (설정 변경 등)
chrome.runtime.onMessage.addListener((request) => {
    if (request.action === "SETTINGS_UPDATED" || request.action === "SCHEDULE_UPDATED") {
        broadcastSettingsUpdate();
        checkScheduleStatus(); 
    }
});

// 탭 업데이트 (URL 변경, 로드 완료) - ⭐️ 여기서 visits 증가
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    // 완전한 페이지 로드 혹은 URL 변경 시
    if (tab.url && changeInfo.status === 'complete') {
        // 1. 필터 적용 검사
        sendFrictionMessage(tabId, tab.url);
        
        // 2. 시간 정산 및 방문 횟수 증가 (visits + 1)
        settleTabTime(tab.url, tab.active, true); 
    }
});

// 탭 활성화 (탭 전환) - visits는 증가시키지 않고 시간만 정산
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    if (tab && tab.url) {
        // 1. 활성 탭에 대해 필터 적용 검사
        sendFrictionMessage(tab.id, tab.url);
        
        // 2. 시간 정산: 이전 탭 시간을 저장하고 현재 탭의 lastTrackedTime을 리셋
        settleTabTime(tab.url, true, false); // visits 증가 안함 (탭 전환은 방문으로 계산 X)
    }
});

// 브라우저 포커스 변경
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) {
        // 포커스 획득 시: 현재 활성 탭에 대해 정산 및 필터 적용
        try {
            const window = await chrome.windows.get(windowId, { populate: true });
            const activeTab = window.tabs.find(t => t.active);
            if(activeTab && activeTab.url) {
                sendFrictionMessage(activeTab.id, activeTab.url);
                settleTabTime(activeTab.url, true, false);
            }
        } catch (e) { }
    } else {
        // 포커스 상실 시: 트래킹 중단 전 전체 정산 한번 수행
        trackAllTabsBatch();
        await saveStatsCache(); // ✨ 데이터 유실 방지를 위해 최종 저장
    }
});

// ✨ 서비스 워커 종료 직전 리스너 추가 (가장 중요)
chrome.runtime.onSuspend.addListener(() => {
    saveStatsCache(); // 서비스 워커 종료 전에 반드시 저장
});

// 초기화: 먼저 캐시 로드 후 알람 생성
loadStatsCache().then(() => {
    chrome.alarms.create('oneMinuteTick', { periodInMinutes: 1 });
});