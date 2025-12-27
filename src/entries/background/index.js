import DataManager from '../../shared/storage/DataManager.js';
import {
    CONFIG_DEFAULT_FILTER_SETTINGS,
    clampFilterStep,
    getFilterStepValue,
    materializeFilterSettings,
    normalizeFilterSettings,
} from '../../shared/config/index.js';
import { isFrictionTime, getLocalDateStr, ensureNumber, getHostname } from '../../shared/utils/index.js';
import { BEHAVIOR_METRIC_KEYS, createBehaviorMetrics } from '../../features/behavior-engine/index.js';

// ===========================================================
// 0. 상수 및 전역 변수 설정
// ===========================================================

const dataManager = DataManager.getInstance();
const DEFAULT_FILTER_SETTINGS = CONFIG_DEFAULT_FILTER_SETTINGS;
const SHORT_DWELL_THRESHOLD = 10 * 1000;
const SEQUENCE_INTERVAL_MS = 10 * 1000;
const MAX_SEQUENCE_POINTS = 6;
const SESSION_GAP_MS = 5 * 60_000;
const GAP_COMPENSATION_MIN_MS = 2 * 60_000;
const GAP_COMPENSATION_MAX_MS = 30 * 60_000;
const SESSION_ACTIVE_TAB_KEY = 'behaviorActiveTab';
const SESSION_LAST_TRACKED_KEY = 'behaviorLastTrackedAt';
const SESSION_DOMAIN_SESSION_KEY = 'behaviorDomainSession';
const COMMIT_DEBOUNCE_MS = 3000;

let currentTickBuffer = createEmptyTickBuffer();
let statsCache = { dates: {}, analysisLogs: [], analysisSummary: {} };
let cacheLoaded = false;
let statsDirty = false;
let lastTickAt = 0;
let lastPurgeAt = 0;
let lastTrackedAt = 0;

let idleState = 'active';
let lastIdleStateCheck = 0;
let lastActiveTabId = null;  // current foreground tab id
let focusedWindowId = null;  // current focused window id
let tabEntryTimes = new Map();
let tabLastActiveAt = new Map();
let activeTabInfo = { tabId: null, hostname: null, startedAt: null, audible: false };
let domainSessionState = new Map();
let filterChangedInTick = false;

const TRACKING_INTERVAL_MS = 60_000; // 1 minute
const LONG_GAP_LIMIT_MS = TRACKING_INTERVAL_MS * 2;
const MAX_DAYS_STORED = 90;
const ANALYSIS_LOG_DAYS = 7;
const IDLE_DETECTION_SECONDS = 60;
const IDLE_STATE_CACHE_TTL_MS = 10_000;
const IDLE_TAB_THRESHOLD_MS = 5 * 60_000;

// ===========================================================
// 1. Utility helpers
// ===========================================================

function createEmptyMetrics() {
    return createBehaviorMetrics();
}

function createEmptyTickBuffer() {
    return {
        metrics: createEmptyMetrics(),
        focusDurations: new Map(),
        startTs: Date.now(),
        sequenceParts: [],
        lastSequenceMetrics: createEmptyMetrics(),
        lastSequenceAt: Date.now(),
        newSessions: new Set(),
    };
}

const DEFAULT_NUDGE_CONFIG = {
    enabled: false,
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
        handleIdleStateChange(state);
    });

    chrome.idle.queryState(IDLE_DETECTION_SECONDS, (state) => {
        if (chrome.runtime.lastError) return;
        handleIdleStateChange(state);
    });
}

function getIdleState({ force = false } = {}) {
    if (!chrome.idle) return Promise.resolve('active');
    const now = Date.now();
    if (!force && now - lastIdleStateCheck < IDLE_STATE_CACHE_TTL_MS) return Promise.resolve(idleState);
    lastIdleStateCheck = now;
    return new Promise((resolve) => {
        chrome.idle.queryState(IDLE_DETECTION_SECONDS, (state) => {
            if (chrome.runtime.lastError) return resolve(idleState);
            handleIdleStateChange(state);
            resolve(idleState);
        });
    });
}

function handleIdleStateChange(state) {
    const nextState = state || idleState;
    const now = Date.now();
    if (nextState === idleState) {
        lastIdleStateCheck = now;
        return;
    }

    if (idleState === 'active' && nextState !== 'active') {
        recordActiveTabDuration(now);
        if (activeTabInfo) {
            activeTabInfo.startedAt = activeTabInfo.audible ? now : null;
            persistActiveTabInfo();
        }
    } else if (idleState !== 'active' && nextState === 'active') {
        if (activeTabInfo && activeTabInfo.hostname) {
            activeTabInfo.startedAt = now;
            persistActiveTabInfo();
        }
    }

    idleState = nextState;
    lastIdleStateCheck = now;
}

function mergeNudgeConfig(partial) {
    const src = partial && typeof partial === 'object' ? partial : {};
    const enabled = typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_NUDGE_CONFIG.enabled;
    return {
        ...DEFAULT_NUDGE_CONFIG,
        ...src,
        enabled,
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

function cloneMetrics(metrics = {}) {
    const next = {};
    for (const key of BEHAVIOR_METRIC_KEYS) {
        next[key] = ensureNumber(metrics[key]);
    }
    return next;
}

function diffMetrics(current = {}, baseline = {}) {
    const delta = {};
    for (const key of BEHAVIOR_METRIC_KEYS) {
        const value = ensureNumber(current[key]) - ensureNumber(baseline[key]);
        delta[key] = value > 0 ? value : 0;
    }
    return delta;
}

function serializeSequence(sequenceParts = []) {
    return sequenceParts
        .map((part) => BEHAVIOR_METRIC_KEYS.map((key) => ensureNumber(part?.[key])).join(','))
        .join('|');
}

function captureSequenceSample(now = Date.now(), { force = false } = {}) {
    if (!currentTickBuffer) return;
    const elapsed = now - currentTickBuffer.lastSequenceAt;
    if (!force && elapsed < SEQUENCE_INTERVAL_MS) return;

    const delta = diffMetrics(currentTickBuffer.metrics, currentTickBuffer.lastSequenceMetrics);
    if (currentTickBuffer.sequenceParts.length >= MAX_SEQUENCE_POINTS) {
        const last = currentTickBuffer.sequenceParts[currentTickBuffer.sequenceParts.length - 1];
        for (const key of BEHAVIOR_METRIC_KEYS) {
            last[key] = ensureNumber(last[key]) + ensureNumber(delta[key]);
        }
    } else {
        currentTickBuffer.sequenceParts.push(delta);
    }

    currentTickBuffer.lastSequenceMetrics = cloneMetrics(currentTickBuffer.metrics);
    currentTickBuffer.lastSequenceAt = now;
}

function finalizeSequence(now = Date.now()) {
    captureSequenceSample(now, { force: true });
    while (currentTickBuffer.sequenceParts.length < MAX_SEQUENCE_POINTS) {
        currentTickBuffer.sequenceParts.push(createEmptyMetrics());
    }
    return currentTickBuffer.sequenceParts;
}

function updateSessionDwell(hostname, elapsed, now) {
    if (!hostname || !Number.isFinite(elapsed) || elapsed <= 0) return;
    const segmentStart = now - elapsed;
    const state = domainSessionState.get(hostname) || {
        lastSeenAt: null,
        sessionStartedAt: segmentStart,
        dwellMs: 0,
    };

    let isNewSession = false;
    if (!Number.isFinite(state.lastSeenAt) || segmentStart - state.lastSeenAt >= SESSION_GAP_MS) {
        isNewSession = true;
        state.sessionStartedAt = segmentStart;
        state.dwellMs = 0;
    }

    state.dwellMs += elapsed;
    state.lastSeenAt = now;
    domainSessionState.set(hostname, state);

    if (isNewSession && currentTickBuffer?.newSessions) {
        currentTickBuffer.newSessions.add(hostname);
    }

    void dataManager.setSession({
        [SESSION_DOMAIN_SESSION_KEY]: {
            hostname,
            sessionStartedAt: state.sessionStartedAt,
            dwellMs: state.dwellMs,
            lastSeenAt: state.lastSeenAt,
        },
    });
}

function getSessionDwell(hostname) {
    const state = domainSessionState.get(hostname);
    return state ? ensureNumber(state.dwellMs) : 0;
}

function setLastTrackedAt(now) {
    if (!Number.isFinite(now)) return;
    lastTrackedAt = now;
    void dataManager.setSession({ [SESSION_LAST_TRACKED_KEY]: now });
}

function persistActiveTabInfo(info = activeTabInfo) {
    const payload = info && info.hostname
        ? {
            tabId: info.tabId,
            hostname: info.hostname,
            startedAt: info.startedAt,
            audible: info.audible ?? false,
        }
        : { tabId: null, hostname: null, startedAt: null, audible: false };
    void dataManager.setSession({ [SESSION_ACTIVE_TAB_KEY]: payload });
}

function setActiveTabAudible(isAudible, now = Date.now()) {
    if (!activeTabInfo) return;
    const nextAudible = !!isAudible;
    if (activeTabInfo.audible === nextAudible) return;
    activeTabInfo.audible = nextAudible;

    if (idleState !== 'active') {
        if (nextAudible) {
            activeTabInfo.startedAt = now;
        } else {
            recordActiveTabDuration(now);
            activeTabInfo.startedAt = null;
        }
    }

    persistActiveTabInfo();
}

async function getActiveTabAudible() {
    if (activeTabInfo && typeof activeTabInfo.audible === 'boolean') return activeTabInfo.audible;
    if (lastActiveTabId === null) return false;
    try {
        const tab = await chrome.tabs.get(lastActiveTabId);
        if (tab) {
            activeTabInfo = {
                tabId: tab.id,
                hostname: activeTabInfo?.hostname ?? getHostname(tab.url),
                startedAt: activeTabInfo?.startedAt ?? null,
                audible: !!tab.audible,
            };
            persistActiveTabInfo();
            return !!tab.audible;
        }
    } catch (_) {}
    return false;
}

// ===========================================================
// 2. Cache + behavior buffer
// ===========================================================

function markStatsDirty() {
    statsDirty = true;
}

async function loadStatsCache() {
    if (cacheLoaded) return;
    try {
        const stats = await dataManager.getStats();
        statsCache = stats;
        if (!statsCache.analysisSummary || typeof statsCache.analysisSummary !== 'object') {
            statsCache.analysisSummary = {};
        }
        pruneOldData();
        cacheLoaded = true;
    } catch (e) {
        console.error("Failed to load stats:", e);
        cacheLoaded = true;
    }
}

async function saveStatsCache({ force = false } = {}) {
    if (!statsDirty && !force) return;
    try {
        await dataManager.setStats(statsCache);
        statsDirty = false;
    } catch (e) {
        console.error("Failed to save stats:", e);
    }
}

function scheduleCommit(now) {
    recordActiveTabDuration(now);
    if (commitTimeoutId) clearTimeout(commitTimeoutId);
    commitTimeoutId = setTimeout(() => {
        commitTimeoutId = null;
        saveStatsCache({ force: true });
    }, COMMIT_DEBOUNCE_MS);
}

function maybePurgeAnalysisLogs(now = Date.now()) {
    if (now - lastPurgeAt < 60 * 60 * 1000) return;
    lastPurgeAt = now;

    if (!Array.isArray(statsCache.analysisLogs)) {
        statsCache.analysisLogs = [];
        return;
    }

    const cutoff = now - ANALYSIS_LOG_DAYS * 24 * 60 * 60 * 1000;
    const expired = [];
    const retained = [];

    for (const entry of statsCache.analysisLogs) {
        const ts = Number(entry?.ts ?? entry?.timestamp ?? entry?.time);
        if (!Number.isFinite(ts) || ts >= cutoff) {
            retained.push(entry);
        } else {
            expired.push(entry);
        }
    }

    if (expired.length === 0) return;

    if (!statsCache.analysisSummary || typeof statsCache.analysisSummary !== 'object') {
        statsCache.analysisSummary = {};
    }

    for (const entry of expired) {
        const ts = Number(entry?.ts ?? entry?.timestamp ?? entry?.time);
        const dateStr = entry?.dateStr || (Number.isFinite(ts) ? getLocalDateStr(ts) : getLocalDateStr());
        const bucket = statsCache.analysisSummary[dateStr] || {
            totalTicks: 0,
            focusMs: 0,
            sessionsStarted: 0,
            frictionChanges: 0,
            metricsTotal: createEmptyMetrics(),
        };

        bucket.totalTicks += 1;
        if (entry?.focusTab?.dwellInTick) bucket.focusMs += ensureNumber(entry.focusTab.dwellInTick);
        if (entry?.focusTab?.isNewSession) bucket.sessionsStarted += 1;
        if (entry?.appliedFriction?.isChangedInTick) bucket.frictionChanges += 1;

        const total = entry?.focusTab?.metrics?.total || {};
        for (const key of BEHAVIOR_METRIC_KEYS) {
            bucket.metricsTotal[key] = ensureNumber(bucket.metricsTotal[key]) + ensureNumber(total[key]);
        }

        statsCache.analysisSummary[dateStr] = bucket;
    }

    statsCache.analysisLogs = retained;
    statsDirty = true;
}

function recordBehaviorEvent(event) {
    if (!event || !currentTickBuffer?.metrics) return;
    const metrics = currentTickBuffer.metrics;
    const name = event.name;

    switch (name) {
        case 'click':
            metrics.clicks += 1;
            break;
        case 'backspace':
            metrics.backspaces += 1;
            break;
        case 'drag':
            metrics.dragCount += 1;
            break;
        case 'backHistory':
            metrics.backHistory += 1;
            break;
        case 'videoSkip':
            metrics.videoSkips += 1;
            break;
        case 'scroll': {
            const dx = Number(event.deltaX) || 0;
            const dy = Number(event.deltaY) || 0;
            metrics.scrollEvents += 1;
            metrics.scrollDeltaX += Math.abs(dx);
            metrics.scrollDeltaY += Math.abs(dy);
            break;
        }
        case 'scrollSpike':
            metrics.scrollSpikes += 1;
            break;
        default:
            break;
    }
}

function recordActiveTabDuration(now) {
    if (!activeTabInfo || !activeTabInfo.hostname) return;
    if (!Number.isFinite(activeTabInfo.startedAt)) return;

    const elapsed = now - activeTabInfo.startedAt;
    if (elapsed <= 0) {
        activeTabInfo.startedAt = now;
        persistActiveTabInfo();
        return;
    }

    const prev = currentTickBuffer.focusDurations.get(activeTabInfo.hostname) || 0;
    currentTickBuffer.focusDurations.set(activeTabInfo.hostname, prev + elapsed);
    activeTabInfo.startedAt = now;
    updateSessionDwell(activeTabInfo.hostname, elapsed, now);
    setLastTrackedAt(now);
    persistActiveTabInfo();
}

async function applyGapCompensation(now) {
    if (!activeTabInfo || !activeTabInfo.hostname) return false;
    if (!Number.isFinite(lastTrackedAt) || lastTrackedAt <= 0) {
        setLastTrackedAt(now);
        return false;
    }

    const gap = now - lastTrackedAt;
    if (gap < GAP_COMPENSATION_MIN_MS || gap >= GAP_COMPENSATION_MAX_MS) {
        setLastTrackedAt(now);
        return false;
    }

    const idleStateNow = await getIdleState({ force: true });
    const audibleActive = await getActiveTabAudible();
    if (idleStateNow !== 'active' && !audibleActive) {
        setLastTrackedAt(now);
        return false;
    }

    await loadStatsCache();
    const hostname = activeTabInfo.hostname;
    const dateStr = getLocalDateStr(now);
    if (!statsCache.dates[dateStr]) {
        statsCache.dates[dateStr] = {
            domains: {},
            totals: { totalActive: 0, totalBackground: 0, blockedActive: 0, blockedBackground: 0 },
        };
    }

    const dateData = statsCache.dates[dateStr];
    ensureDateTotals(dateData);

    if (!dateData.domains[hostname]) {
        dateData.domains[hostname] = {
            active: 0,
            background: 0,
            visits: 0,
            hourly: Array(24).fill(0),
            hourlyActive: Array(24).fill(0),
            hourlyBackground: Array(24).fill(0),
            lastTrackedTime: now,
        };
    }

    const domainData = dateData.domains[hostname];
    ensureHourlyArrays(domainData);

    domainData.active += gap;
    addElapsedToHourly(domainData, now - gap, now, true);
    domainData.lastTrackedTime = now;
    dateData.totals.totalActive += gap;

    const blockedUrls = (await chrome.storage.local.get('blockedUrls')).blockedUrls || [];
    if (blockedUrls.includes(hostname)) {
        dateData.totals.blockedActive += gap;
    }

    const prevFocus = currentTickBuffer.focusDurations.get(hostname) || 0;
    currentTickBuffer.focusDurations.set(hostname, prevFocus + gap);
    updateSessionDwell(hostname, gap, now);

    activeTabInfo.startedAt = now;
    persistActiveTabInfo();
    statsDirty = true;
    setLastTrackedAt(now);
    return true;
}

function updateActiveTabInfo(tab, now) {
    if (!tab || !tab.url) {
        activeTabInfo = { tabId: null, hostname: null, startedAt: null, audible: false };
        persistActiveTabInfo();
        return;
    }
    const hostname = getHostname(tab.url);
    if (!hostname) {
        activeTabInfo = { tabId: tab.id, hostname: null, startedAt: null, audible: !!tab.audible };
        persistActiveTabInfo();
        return;
    }
    const isAudible = typeof tab.audible === 'boolean' ? tab.audible : activeTabInfo?.audible;
    activeTabInfo = {
        tabId: tab.id,
        hostname,
        startedAt: (idleState === 'active' || isAudible) ? now : null,
        audible: !!isAudible,
    };
    persistActiveTabInfo();
}

function buildAppliedFrictionSnapshot(filterSettings, { isChangedInTick = false } = {}) {
    const normalized = normalizeFilterSettings(filterSettings || {});
    const stepKeyList = ['blur', 'saturation', 'textOpacity', 'letterSpacing', 'clickDelay', 'scrollFriction'];

    const materialized = materializeFilterSettings(filterSettings || {});
    const stepSnapshot = {};
    for (const key of stepKeyList) {
        const entry = normalized[key] || {};
        const isActive = !!entry.isActive;
        const selectedStepRaw = entry.step ?? entry.value ?? 1;
        const clamped = clampFilterStep(selectedStepRaw);
        const selectedStep = clamped <= 0 ? 1 : clamped;
        const selectedValue = getFilterStepValue(key, selectedStep);
        const appliedStep = isActive ? selectedStep : 0;
        const appliedValue = getFilterStepValue(key, appliedStep);

        stepSnapshot[key] = {
            isActive,
            step: appliedStep,
            value: appliedValue,
            selectedStep,
            selectedValue,
            materializedValue: materialized?.[key]?.value ?? null,
        };
    }
    return {
        steps: stepSnapshot,
        toggles: {
            textShuffle: {
                isActive: !!normalized.textShuffle?.isActive,
                value: normalized.textShuffle?.value ?? null,
            },
            socialMetrics: {
                isActive:
                    !!normalized.socialEngagement?.isActive || !!normalized.socialExposure?.isActive,
            },
        },
        isChangedInTick: !!isChangedInTick,
    };
}

function buildFocusTabSnapshot(metricsSequence, metricsTotal, activeType = 'active') {
    const hostname = activeTabInfo?.hostname;
    if (!hostname) return null;
    const durationMs = currentTickBuffer.focusDurations.get(hostname) || 0;
    const sessionDwell = getSessionDwell(hostname);
    const isNewSession = currentTickBuffer?.newSessions?.has(hostname) || false;
    return {
        hostname,
        dwellInTick: Math.max(0, Math.round(durationMs)),
        sessionDwell: Math.max(0, Math.round(sessionDwell)),
        isNewSession,
        activeType,
        metrics: {
            total: metricsTotal,
            sequence: metricsSequence,
        },
    };
}

async function buildBackgroundContext(now) {
    const tabs = await chrome.tabs.query({});
    const audibleTabs = new Set();
    const idleTabs = new Set();

    const isWindowFocused = focusedWindowId !== null && focusedWindowId !== chrome.windows.WINDOW_ID_NONE;

    for (const tab of tabs) {
        const hostname = getHostname(tab.url);
        if (!hostname || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) continue;

        if (tab.audible) audibleTabs.add(hostname);

        const isActive = isWindowFocused && tab.active && tab.windowId === focusedWindowId;
        if (isActive) continue;

        const lastActiveAt = tabLastActiveAt.get(tab.id);
        if (lastActiveAt && now - lastActiveAt >= IDLE_TAB_THRESHOLD_MS) {
            idleTabs.add(hostname);
        }
    }

    return {
        audibleTabs: Array.from(audibleTabs),
        idleTabs: Array.from(idleTabs),
    };
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
    if (!statsCache.dates) {
        statsCache.dates = {};
        return false;
    }
    const dates = Object.keys(statsCache.dates);
    if (dates.length <= MAX_DAYS_STORED) return false;
    dates.sort();
    let changed = false;
    for (let i = 0; i < dates.length - MAX_DAYS_STORED; i++) {
        delete statsCache.dates[dates[i]];
        changed = true;
    }
    if (changed) statsDirty = true;
    return changed;
}


function ensureDateTotals(dateData) {
    if (!dateData || typeof dateData !== "object") return;
    if (!dateData.domains || typeof dateData.domains !== "object") dateData.domains = {};
    if (!dateData.totals || typeof dateData.totals !== "object") {
        dateData.totals = { totalActive: 0, totalBackground: 0, blockedActive: 0, blockedBackground: 0 };
        return;
    }
    const defaults = { totalActive: 0, totalBackground: 0, blockedActive: 0, blockedBackground: 0 };
    for (const [key, value] of Object.entries(defaults)) {
        if (!Number.isFinite(dateData.totals[key])) dateData.totals[key] = value;
    }
}

// ===========================================================
// 3. 시간 계산 핵심 로직 (정확도 복원)
// ===========================================================

// 단일 도메인의 시간을 계산하고 캐시에 반영
async function calculateTabTime(
    hostname,
    now,
    isActive,
    blockedUrlsOverride = null,
    { idleOverride = false } = {},
) {
    const dateStr = getLocalDateStr(now);
    
    if (!statsCache.dates[dateStr]) {
        statsCache.dates[dateStr] = { domains: {}, totals: { totalActive: 0, totalBackground: 0, blockedActive: 0, blockedBackground: 0 } };
    }

    const dateData = statsCache.dates[dateStr];
    ensureDateTotals(dateData);
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
    if (idleStateNow !== 'active' && !idleOverride) {
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
async function settleTabTime(
    url,
    isActive,
    isNewVisit = false,
    nowOverride = null,
    { idleOverride = false } = {},
) {
    await loadStatsCache();
    const hostname = getHostname(url);
    if (!hostname || url.startsWith('chrome://') || hostname === chrome.runtime.id) return;
    
    const now = typeof nowOverride === 'number' ? nowOverride : Date.now();
    let isChanged = await calculateTabTime(hostname, now, isActive, null, { idleOverride });
    
    if (isNewVisit) {
        const dateStr = getLocalDateStr(now);
        if (statsCache.dates[dateStr] && statsCache.dates[dateStr].domains[hostname]) {
            statsCache.dates[dateStr].domains[hostname].visits += 1;
            isChanged = true;
        }
    }
    
    if (isChanged) markStatsDirty();
}

// 현재 활성 탭의 시간을 강제로 정산 (탭 전환, 창 전환 시 호출)
async function settlePreviousTab(nowOverride = null) {
    if (lastActiveTabId === null) return;
    try {
        const tab = await chrome.tabs.get(lastActiveTabId);
        if (tab && tab.url) {
            // 이 탭은 지금까지 'Active' 였음이 확실함
            await settleTabTime(tab.url, true, false, nowOverride, { idleOverride: !!tab.audible });
        }
    } catch (e) { /* 탭이 이미 닫힘 */ }
}

// 1분 주기 배치 처리 (모든 탭의 lastTrackedTime을 현 시간으로 끌어올림)
async function trackAllTabsBatch(nowOverride = null) {
    await loadStatsCache();
    const tabs = await chrome.tabs.query({});
    const now = typeof nowOverride === 'number' ? nowOverride : Date.now();
    let isChanged = false;
    const items = await chrome.storage.local.get('blockedUrls');
    
    // 현재 포커스된 창이 없으면 모두 비활성으로 간주
    const isWindowFocused = focusedWindowId !== null && focusedWindowId !== chrome.windows.WINDOW_ID_NONE;

    for (const tab of tabs) {
        const hostname = getHostname(tab.url);
        if (!hostname || tab.url.startsWith('chrome://')) continue;

        // 현재 탭이 활성 상태인지 판단
        const isTabActive = isWindowFocused && tab.active && (tab.windowId === focusedWindowId);
        const idleOverride = isTabActive && !!tab.audible;

        if (isTabActive && tab.id === lastActiveTabId) {
            setActiveTabAudible(!!tab.audible, now);
        }

        if (await calculateTabTime(hostname, now, isTabActive, items.blockedUrls, { idleOverride })) {
            isChanged = true;
        }
    }
    
    if (isChanged) markStatsDirty();
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
        schedule: {
          scheduleActive: false,
          days: [0, 1, 2, 3, 4, 5, 6],
          blocks: [{ startMin: 0, endMin: 1440 }],
          startMin: 0,
          endMin: 1440,
        },
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
        blockedUrls: [],
        schedule: {
          scheduleActive: false,
          days: [0, 1, 2, 3, 4, 5, 6],
          blocks: [{ startMin: 0, endMin: 1440 }],
          startMin: 0,
          endMin: 1440,
        },
        indicatorConfig: { enabled: true },
    });
    const filterSettings = await dataManager.getFilterSettings();
    const hostname = getHostname(url);
    const isBlockedDomain = !!(hostname && items.blockedUrls.includes(hostname));
    const shouldApply = isBlockedDomain && isFrictionTime(items.schedule);
    const filters = materializeFilterSettings(filterSettings || DEFAULT_FILTER_SETTINGS);
    const indicatorEnabled =
        typeof items.indicatorConfig?.enabled === 'boolean' ? items.indicatorConfig.enabled : true;

    try {
        await chrome.tabs.sendMessage(tabId, {
            isBlocked: shouldApply,
            isBlockedDomain,
            hostname,
            filters,
            indicatorEnabled,
        });
    } catch (e) {}

    if (shouldApply) maybeTriggerNudge(tabId, url).catch(()=>{});
}

async function broadcastSettingsUpdate() {
    const tabs = await chrome.tabs.query({});
    for (const tab of tabs) if (tab.url) await sendFrictionMessage(tab.id, tab.url);
}

async function checkScheduleStatus() {
    const items = await chrome.storage.local.get({
      schedule: {
        scheduleActive: false,
        days: [0, 1, 2, 3, 4, 5, 6],
        blocks: [{ startMin: 0, endMin: 1440 }],
        startMin: 0,
        endMin: 1440,
      },
    });
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
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'oneMinuteTick') {
        runTick('alarm').catch(() => {});
    }
});

// [2] 탭 활성화 (사용자가 탭을 클릭함)
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    const now = Date.now();

    await settlePreviousTab(now);
    scheduleCommit(now);

    if (focusedWindowId !== null && activeInfo.windowId !== focusedWindowId) {
        focusedWindowId = activeInfo.windowId;
    }

    if (activeInfo.tabId !== lastActiveTabId) {
        if (lastActiveTabId && tabEntryTimes.has(lastActiveTabId)) {
            const stayDuration = now - tabEntryTimes.get(lastActiveTabId);
            if (stayDuration < SHORT_DWELL_THRESHOLD) {
                currentTickBuffer.metrics.shortDwells += 1;
            }
        }
        currentTickBuffer.metrics.tabSwitches += 1;
    }

    lastActiveTabId = activeInfo.tabId;
    tabLastActiveAt.set(activeInfo.tabId, now);

    try {
        const tab = await chrome.tabs.get(activeInfo.tabId);
        if (tab && tab.url) {
            tabEntryTimes.set(activeInfo.tabId, now);
            updateActiveTabInfo(tab, now);
            await sendFrictionMessage(tab.id, tab.url);
            await settleTabTime(tab.url, false, false, now);
            await maybeTriggerNudge(tab.id, tab.url);
        }
    } catch (e) {}
});

// [3] 윈도우 포커스 변경 (이게 빠져서 그동안 정확도가 낮았음)
chrome.windows.onFocusChanged.addListener(async (windowId) => {
    const now = Date.now();

    await settlePreviousTab(now);
    scheduleCommit(now);

    if (windowId === chrome.windows.WINDOW_ID_NONE) {
        focusedWindowId = null;
        if (activeTabInfo) {
            activeTabInfo.startedAt = null;
            persistActiveTabInfo();
        }
        return;
    }

    focusedWindowId = windowId;
    try {
        const win = await chrome.windows.get(windowId, { populate: true });
        const activeTab = win.tabs.find((t) => t.active);
        if (activeTab) {
            lastActiveTabId = activeTab.id;
            tabLastActiveAt.set(activeTab.id, now);
            if (activeTab.url) {
                updateActiveTabInfo(activeTab, now);
                await sendFrictionMessage(activeTab.id, activeTab.url);
                await settleTabTime(activeTab.url, true, false, now, { idleOverride: !!activeTab.audible });
                await maybeTriggerNudge(activeTab.id, activeTab.url);
            }
        }
    } catch (e) {
        console.error(e);
    }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const now = Date.now();

    if (typeof changeInfo.audible === 'boolean' && activeTabInfo?.tabId === tabId) {
        setActiveTabAudible(changeInfo.audible, now);
    }

    if (changeInfo.status === 'loading' && tab.url) {
        if (tabEntryTimes.has(tabId)) {
            const stayDuration = now - tabEntryTimes.get(tabId);
            if (stayDuration < SHORT_DWELL_THRESHOLD) {
                currentTickBuffer.metrics.shortDwells += 1;
            }
            tabEntryTimes.delete(tabId);
        }
        currentTickBuffer.metrics.pageLoads += 1;
    }

    if (changeInfo.status === 'complete' && tab.url) {
        tabEntryTimes.set(tabId, now);
        const isForegroundActive = focusedWindowId !== null ? (tab.active && tab.windowId === focusedWindowId) : false;
        const idleOverride = isForegroundActive && !!tab.audible;

        await sendFrictionMessage(tabId, tab.url);
        await settleTabTime(tab.url, isForegroundActive, true, null, { idleOverride });

        if (isForegroundActive) {
            lastActiveTabId = tabId;
            tabLastActiveAt.set(tabId, now);
            recordActiveTabDuration(now);
            updateActiveTabInfo(tab, now);
            await maybeTriggerNudge(tabId, tab.url);
        }
    }
});

chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabEntryTimes.has(tabId)) {
        const stayDuration = Date.now() - tabEntryTimes.get(tabId);
        if (stayDuration < SHORT_DWELL_THRESHOLD) {
            currentTickBuffer.metrics.shortDwells += 1;
        }
        tabEntryTimes.delete(tabId);
    }

    tabLastActiveAt.delete(tabId);
    if (activeTabInfo?.tabId === tabId) {
        recordActiveTabDuration(Date.now());
        activeTabInfo = { tabId: null, hostname: null, startedAt: null, audible: false };
        persistActiveTabInfo();
    }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (!request) return false;

    if (request.type === 'TRACK_BEHAVIOR_EVENT') {
        recordBehaviorEvent(request.event);
        return false;
    }

    const action = request.action || request.type;

    if (action === 'DEBUG_GET_CACHE') {
        sendResponse({
            cache: statsCache,
            loaded: cacheLoaded,
            lastActiveTab: lastActiveTabId,
            focusedWin: focusedWindowId,
        });
        return false;
    }

    if (action === 'DEBUG_RESET_STATS') {
        loadStatsCache()
            .then(async () => {
                statsCache = { dates: {}, analysisLogs: [], analysisSummary: {} };
                await dataManager.setStats(statsCache);
                statsDirty = false;
                sendResponse({ success: true });
            })
            .catch((err) => sendResponse({ success: false, error: err.message }));
        return true;
    }

    if (action === 'DEBUG_FORCE_SAVE') {
        saveStatsCache({ force: true }).then(() => sendResponse({ success: true }));
        return true;
    }

    if (action === 'NUDGE_ACK') {
        const key = request.key;
        if (key) {
            markNudgeAck(key).then(() => sendResponse({ success: true }));
            return true;
        }
        sendResponse({ success: false });
        return false;
    }

    if (action === 'GET_DASHBOARD_DATA') {
        loadStatsCache().then(() => {
            sendResponse({
                success: true,
                stats: statsCache,
            });
        });
        return true;
    }

    if (action === 'REFRESH_SETTINGS') {
        broadcastSettingsUpdate().then(() => sendResponse({ success: true }));
        return true;
    }

    if (action === 'SETTINGS_UPDATED') {
        broadcastSettingsUpdate().then(() => sendResponse({ success: true }));
        return true;
    }

    if (action === 'NUDGE_CONFIG_UPDATED') {
        (async () => {
            const items = await chrome.storage.local.get({ nudgeConfig: {} });
            const config = mergeNudgeConfig(items.nudgeConfig);
            if (!config.enabled) {
                const tabs = await chrome.tabs.query({});
                await Promise.all(
                    tabs
                        .filter((tab) => tab?.id && tab.url && !tab.url.startsWith('chrome://'))
                        .map((tab) =>
                            chrome.tabs.sendMessage(tab.id, { type: 'NUDGE_STOP' }).catch(() => {})
                        )
                );
            }
            sendResponse({ success: true });
        })().catch(() => sendResponse({ success: false }));
        return true;
    }

    if (action === 'GET_FILTER_INDICATOR_INFO') {
        (async () => {
            const targetUrl = request.url || sender?.tab?.url || '';
            const hostname = getHostname(targetUrl);
            const items = await chrome.storage.local.get({
                blockedUrls: [],
                schedule: {
                  scheduleActive: false,
                  days: [0, 1, 2, 3, 4, 5, 6],
                  blocks: [{ startMin: 0, endMin: 1440 }],
                  startMin: 0,
                  endMin: 1440,
                },
                indicatorConfig: { enabled: true },
            });
            const isBlockedDomain = !!(hostname && items.blockedUrls.includes(hostname));
            const shouldApply = isBlockedDomain && isFrictionTime(items.schedule);
            const indicatorEnabled =
                typeof items.indicatorConfig?.enabled === 'boolean' ? items.indicatorConfig.enabled : true;

            const filterSettings = await dataManager.getFilterSettings();
            const filters = materializeFilterSettings(filterSettings || DEFAULT_FILTER_SETTINGS);

            await loadStatsCache();
            const dateStr = getLocalDateStr();
            const domainData = hostname ? statsCache?.dates?.[dateStr]?.domains?.[hostname] : null;
            const dailyMs = ensureNumber(domainData?.active) + ensureNumber(domainData?.background);

            sendResponse({
                success: true,
                hostname,
                isBlockedDomain,
                shouldApply,
                indicatorEnabled,
                dailyMs,
                filters,
            });
        })().catch(() => {
            sendResponse({ success: false });
        });
        return true;
    }

    return false;
});

// ===========================================================
// 5. Tick + analysis
// ===========================================================

let tickInFlight = false;
let tickIntervalId = null;
let sequenceIntervalId = null;
let commitTimeoutId = null;

function resetTickBuffer(now = Date.now()) {
    currentTickBuffer = createEmptyTickBuffer();
    currentTickBuffer.startTs = now;
    currentTickBuffer.lastSequenceAt = now;
    currentTickBuffer.lastSequenceMetrics = cloneMetrics(currentTickBuffer.metrics);
    currentTickBuffer.sequenceParts = [];
    currentTickBuffer.newSessions = new Set();
    if (activeTabInfo && activeTabInfo.hostname && idleState === 'active') {
        activeTabInfo.startedAt = now;
        persistActiveTabInfo();
    }
    filterChangedInTick = false;
}

async function runTick(source = 'interval') {
    const now = Date.now();
    if (tickInFlight) return;
    if (lastTickAt && now - lastTickAt < TRACKING_INTERVAL_MS * 0.5) return;
    tickInFlight = true;
    lastTickAt = now;

    try {
        await loadStatsCache();
        await applyGapCompensation(now);
        recordActiveTabDuration(now);

        await trackAllTabsBatch(now);
        await checkScheduleStatus();

        const idleStateNow = await getIdleState({ force: true });
        const isAudibleActive = await getActiveTabAudible();
        const activeType =
            idleStateNow === 'active' ? 'active' : (isAudibleActive ? 'passive' : 'idle');

        const filterSettings = await dataManager.getFilterSettings();
        const sequenceParts = finalizeSequence(now);
        const metricsSequence = serializeSequence(sequenceParts);
        const metricsTotal = cloneMetrics(currentTickBuffer.metrics);
        const focusTab = buildFocusTabSnapshot(metricsSequence, metricsTotal, activeType);
        const backgroundContext = await buildBackgroundContext(now);
        const appliedFriction = buildAppliedFrictionSnapshot(filterSettings, {
            isChangedInTick: filterChangedInTick,
        });

        if (!Array.isArray(statsCache.analysisLogs)) statsCache.analysisLogs = [];
        statsCache.analysisLogs.push({
            ts: now,
            dateStr: getLocalDateStr(now),
            focusTab,
            backgroundContext,
            appliedFriction,
        });
        statsDirty = true;

        maybePurgeAnalysisLogs(now);

        if (lastActiveTabId !== null) {
            try {
                const tab = await chrome.tabs.get(lastActiveTabId);
                if (tab?.url) await maybeTriggerNudge(lastActiveTabId, tab.url);
            } catch (_) {}
        }

        setLastTrackedAt(now);
        await saveStatsCache();
    } catch (e) {
        console.error('Tick Error:', e);
    } finally {
        resetTickBuffer(now);
        tickInFlight = false;
    }
}

function startTickTimer() {
    if (tickIntervalId) return;
    tickIntervalId = setInterval(() => {
        runTick('interval').catch(() => {});
    }, TRACKING_INTERVAL_MS);
}

function startSequenceTimer() {
    if (sequenceIntervalId) return;
    sequenceIntervalId = setInterval(() => {
        captureSequenceSample(Date.now());
    }, SEQUENCE_INTERVAL_MS);
}

// ===========================================================
// 6. Init
// ===========================================================

async function init() {
    const session = await dataManager.getSession({
        [SESSION_ACTIVE_TAB_KEY]: null,
        [SESSION_LAST_TRACKED_KEY]: 0,
        [SESSION_DOMAIN_SESSION_KEY]: null,
    });
    const storedActive = session[SESSION_ACTIVE_TAB_KEY];
    if (storedActive && storedActive.hostname) {
        activeTabInfo = {
            tabId: storedActive.tabId ?? null,
            hostname: storedActive.hostname ?? null,
            startedAt: storedActive.startedAt ?? null,
            audible: !!storedActive.audible,
        };
        if (storedActive.tabId) lastActiveTabId = storedActive.tabId;
    }
    const storedTrackedAt = ensureNumber(session[SESSION_LAST_TRACKED_KEY]);
    if (storedTrackedAt > 0) lastTrackedAt = storedTrackedAt;
    const storedSession = session[SESSION_DOMAIN_SESSION_KEY];
    if (storedSession && storedSession.hostname) {
        domainSessionState.set(storedSession.hostname, {
            lastSeenAt: storedSession.lastSeenAt ?? null,
            sessionStartedAt: storedSession.sessionStartedAt ?? null,
            dwellMs: storedSession.dwellMs ?? 0,
        });
    }

    await loadStatsCache();
    ensureAlarm();
    startTickTimer();
    startSequenceTimer();
    setupIdleDetection();

    if (chrome?.storage?.onChanged) {
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName !== 'local') return;
            if (changes.filterSettings) {
                filterChangedInTick = true;
            }
        });
    }

    try {
        const win = await chrome.windows.getLastFocused({ populate: true });
        if (win && win.id !== chrome.windows.WINDOW_ID_NONE) {
            focusedWindowId = win.id;
            const activeTab = win.tabs?.find((t) => t.active);
            if (activeTab) {
                const now = Date.now();
                lastActiveTabId = activeTab.id;
                tabLastActiveAt.set(activeTab.id, now);
                updateActiveTabInfo(activeTab, now);
                settleTabTime(activeTab.url, true, false, now, { idleOverride: !!activeTab.audible });
            }
        } else {
            focusedWindowId = null;
        }
    } catch (e) {
        console.log('Init: focused window lookup failed');
    }
}

init();
