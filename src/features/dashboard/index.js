import { CONFIG_DEFAULT_FILTER_SETTINGS, normalizeFilterSettings } from '../../shared/config/index.js';
import { createOverviewTab } from './tabs/overviewTab.js';
import { createDetailedRecapTab } from './tabs/detailedRecapTab.js';
import { createBlocklistTab } from './tabs/blocklistTab.js';
import { createSettingsTab } from './tabs/settingsTab.js';
import { createUtilTab } from './tabs/utilTab.js';
import { createScheduleTab } from './tabs/scheduleTab.js';

const DASHBOARD_ACTIVE_TAB_KEY = 'dashboardActiveTab';
const DASHBOARD_REFRESH_INTERVAL_MS = 60_000;

let currentStats = { dates: {} };
let currentBlockedUrls = [];
let currentSettings = {};
let currentSchedule = { scheduleActive: false, startMin: 0, endMin: 1440 };

let overviewTab = null;
let detailedRecapTab = null;
let blocklistTab = null;
let settingsTab = null;
let utilTab = null;
let scheduleTab = null;

const UI = {};

function mergeFilterSettings(partial) {
  return normalizeFilterSettings(partial || {});
}

function getSavedActiveTabId() {
  try {
    const v = localStorage.getItem(DASHBOARD_ACTIVE_TAB_KEY);
    return typeof v === 'string' && v ? v : null;
  } catch (_) {
    return null;
  }
}

function saveActiveTabId(tabId) {
  try {
    if (!tabId) return;
    localStorage.setItem(DASHBOARD_ACTIVE_TAB_KEY, String(tabId));
  } catch (_) {}
}

function applyActiveTabId(tabId) {
  if (!tabId || !UI.tabs || !UI.contents) return false;
  const tabBtn = Array.from(UI.tabs).find((t) => t?.dataset?.tab === tabId);
  const content = document.getElementById(tabId);
  if (!tabBtn || !content) return false;

  UI.tabs.forEach((t) => t.classList.remove('active'));
  UI.contents.forEach((c) => c.classList.remove('active'));

  tabBtn.classList.add('active');
  content.classList.add('active');
  return true;
}

function initDOMReferences() {
  UI.tabs = document.querySelectorAll('.nav-btn');
  UI.contents = document.querySelectorAll('.tab-content');
  UI.darkModeToggle = document.getElementById('darkModeToggle');

  UI.overview = document.getElementById('overview');
  UI.overviewCarousel = document.getElementById('overviewCarousel');
  UI.overviewCarouselTrack = document.getElementById('overviewCarouselTrack');
  UI.overviewSlides = UI.overviewCarousel ? UI.overviewCarousel.querySelectorAll('.overview-slide') : null;
  UI.overviewPrev = document.getElementById('overviewPrev');
  UI.overviewNext = document.getElementById('overviewNext');
  UI.overviewDots = document.getElementById('overviewDots');

  UI.toggleDaily = document.getElementById('toggleDaily');
  UI.toggleWeekly = document.getElementById('toggleWeekly');
  UI.dailyDate = document.getElementById('dailyDate');
  UI.dailyTotal = document.getElementById('dailyTotal');
  UI.dailyBlocked = document.getElementById('dailyBlocked');
  UI.dailyChange = document.getElementById('dailyChange');
  UI.dailyGraph = document.getElementById('dailyGraph');
  UI.dailyInsight = document.getElementById('dailyInsight');
  UI.dailyAllSitesList = document.getElementById('dailyAllSitesList');
  UI.weeklyTotal = document.getElementById('weeklyTotal');
  UI.weeklyBlocked = document.getElementById('weeklyBlocked');
  UI.weeklyChange = document.getElementById('weeklyChange');
  UI.weeklyGraph = document.getElementById('weeklyGraph');
  UI.weeklyInsight = document.getElementById('weeklyInsight');
  UI.weeklyAllSitesList = document.getElementById('weeklyAllSitesList');

  UI.blockedListDisplay = document.getElementById('blockedListDisplay');
  UI.newBlockUrlInput = document.getElementById('newBlockUrl');
  UI.addBlockBtn = document.getElementById('addBlockBtn');

  UI.settingsGrid = document.getElementById('settingsGrid');
  UI.settingsSubtabButtons = document.querySelectorAll('.settings-subtab-btn');
  UI.settingsPreview = document.getElementById('settingsPreview');
  UI.settingsPreviewDescription = document.getElementById('settingsPreviewDescription');
  UI.previewBefore = document.getElementById('previewBefore');
  UI.previewAfter = document.getElementById('previewAfter');

  UI.utilVideoSkipGuardCard = document.getElementById('utilVideoSkipGuardCard');
  UI.utilVideoSkipGuardToggle = document.getElementById('utilVideoSkipGuardToggle');
  UI.utilVideoSkipGuardStatus = document.getElementById('utilVideoSkipGuardStatus');

  UI.nudgeDebugPanel = document.getElementById('nudgeDebugPanel');
  UI.nudgeSpawnBtn = document.getElementById('nudgeSpawnBtn');
  UI.nudgeStopBtn = document.getElementById('nudgeStopBtn');
  UI.resetStatsBtn = document.getElementById('resetStatsBtn');
  UI.nudgeDebugStatus = document.getElementById('nudgeDebugStatus');
  UI.nudgeSizeRange = document.getElementById('nudgeSizeRange');
  UI.nudgeSizeOutput = document.getElementById('nudgeSizeOutput');
  UI.nudgeSpeedRange = document.getElementById('nudgeSpeedRange');
  UI.nudgeSpeedOutput = document.getElementById('nudgeSpeedOutput');
  UI.nudgeSpawnIntervalRange = document.getElementById('nudgeSpawnIntervalRange');
  UI.nudgeSpawnIntervalOutput = document.getElementById('nudgeSpawnIntervalOutput');
  UI.nudgeMaxSpritesRange = document.getElementById('nudgeMaxSpritesRange');
  UI.nudgeMaxSpritesOutput = document.getElementById('nudgeMaxSpritesOutput');
  UI.nudgeSpeedRampRange = document.getElementById('nudgeSpeedRampRange');
  UI.nudgeSpeedRampOutput = document.getElementById('nudgeSpeedRampOutput');

  UI.nudgeAutoToggle = document.getElementById('nudgeAutoToggle');
  UI.nudgeAutoToggleOutput = document.getElementById('nudgeAutoToggleOutput');
  UI.nudgeAutoThresholdRange = document.getElementById('nudgeAutoThresholdRange');
  UI.nudgeAutoThresholdOutput = document.getElementById('nudgeAutoThresholdOutput');

  UI.scheduleContainer = document.getElementById('time-slider-container');
  UI.scheduleToggle = document.getElementById('schedule-toggle');
  UI.displayStart = document.getElementById('start-time-display');
  UI.displayEnd = document.getElementById('end-time-display');
  UI.sliderRange = document.getElementById('slider-range');
  UI.handleStart = document.getElementById('handle-start');
  UI.handleEnd = document.getElementById('handle-end');
  UI.trackWrapper = document.querySelector('#schedule .slider-track-wrapper');
}

function loadDataAndRender() {
  chrome.storage.local.get(
    {
      stats: { dates: {} },
      blockedUrls: [],
      filterSettings: CONFIG_DEFAULT_FILTER_SETTINGS,
      darkMode: false,
      schedule: { scheduleActive: false, startMin: 0, endMin: 1440 },
    },
    (items) => {
      currentStats = items.stats || { dates: {} };
      currentBlockedUrls = items.blockedUrls || [];
      currentSettings = mergeFilterSettings(items.filterSettings);
      currentSchedule = items.schedule || { scheduleActive: false, startMin: 0, endMin: 1440 };

      document.body.classList.toggle('dark', !!items.darkMode);
      if (UI.darkModeToggle) UI.darkModeToggle.checked = !!items.darkMode;

      renderActiveTab();
    }
  );

  chrome.runtime.sendMessage({ action: 'DEBUG_GET_CACHE' }, (resp) => {
    if (resp && resp.cache && resp.loaded) {
      currentStats = resp.cache;
      renderActiveTab();
    }
  });
}

async function renderActiveTab() {
  const activeTabBtn = document.querySelector('.nav-btn.active');
  if (!activeTabBtn) return;

  const activeTabId = activeTabBtn.dataset.tab;
  switch (activeTabId) {
    case 'overview':
      await overviewTab?.display();
      break;
    case 'detailed-recap':
      detailedRecapTab?.display();
      break;
    case 'blocklist':
      blocklistTab?.display();
      break;
    case 'settings':
      await settingsTab?.display();
      break;
    case 'util':
      await utilTab?.display();
      break;
    case 'schedule':
      scheduleTab?.display();
      break;
  }
}

function toggleBlockDomain(domain) {
  if (currentBlockedUrls.includes(domain)) {
    currentBlockedUrls = currentBlockedUrls.filter((u) => u !== domain);
  } else {
    currentBlockedUrls.push(domain);
  }

  chrome.storage.local.set({ blockedUrls: currentBlockedUrls }, () => {
    renderActiveTab();
  });
}

document.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('js-enabled');
  initDOMReferences();

  // 새로고침/재진입 시 마지막으로 보던 탭 유지
  const savedTabId = getSavedActiveTabId();
  if (savedTabId) applyActiveTabId(savedTabId);

  overviewTab = createOverviewTab({
    UI,
    getState: () => ({ currentStats, currentBlockedUrls }),
    onToggleBlockDomain: toggleBlockDomain,
  });
  detailedRecapTab = createDetailedRecapTab({
    UI,
    getState: () => ({ currentStats, currentBlockedUrls }),
    onToggleBlockDomain: toggleBlockDomain,
  });
  blocklistTab = createBlocklistTab({
    UI,
    getState: () => ({ currentBlockedUrls }),
    onToggleBlockDomain: toggleBlockDomain,
  });
  settingsTab = createSettingsTab({
    UI,
    getSettings: () => currentSettings,
    setSettings: (next) => {
      currentSettings = next;
    },
    mergeFilterSettings,
  });
  utilTab = createUtilTab({
    UI,
    getSettings: () => currentSettings,
    setSettings: (next) => {
      currentSettings = next;
    },
  });
  scheduleTab = createScheduleTab({
    UI,
    getSchedule: () => currentSchedule,
    setSchedule: (next) => {
      currentSchedule = next;
    },
  });

  overviewTab.setup();
  detailedRecapTab.setup();
  blocklistTab.setup();
  settingsTab.setup();
  utilTab.setup();
  scheduleTab.setup();

  loadDataAndRender();

  UI.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const prevTabId = document.querySelector('.nav-btn.active')?.dataset?.tab;
      if (prevTabId === 'settings') settingsTab?.beforeLeave?.();

      UI.tabs.forEach((t) => t.classList.remove('active'));
      UI.contents.forEach((c) => c.classList.remove('active'));

      tab.classList.add('active');
      const target = document.getElementById(tab.dataset.tab);
      if (target) target.classList.add('active');

      saveActiveTabId(tab.dataset.tab);
      renderActiveTab();
    });
  });

  if (UI.darkModeToggle) {
    UI.darkModeToggle.addEventListener('change', () => {
      const isDark = !!UI.darkModeToggle.checked;
      document.body.classList.toggle('dark', isDark);
      chrome.storage.local.set({ darkMode: isDark }, () => renderActiveTab());
    });
  }

  if (UI.resetStatsBtn) {
    UI.resetStatsBtn.addEventListener('click', () => {
      if (!window.confirm('테스트용: 모든 사용 통계를 초기화할까요?')) return;

      const setStatus = (msg) => {
        if (UI.nudgeDebugStatus) UI.nudgeDebugStatus.textContent = msg;
      };

      setStatus('초기화 중...');
      chrome.runtime.sendMessage({ action: 'DEBUG_RESET_STATS' }, (resp) => {
        if (chrome.runtime.lastError) {
          setStatus('초기화 실패');
          return;
        }
        if (!resp || resp.success !== true) {
          setStatus('초기화 실패');
          return;
        }
        currentStats = { dates: {} };
        setStatus('초기화 완료');
        renderActiveTab();
      });
    });
  }

  // 자동 갱신: (1) 대시보드가 보일 때 1분 주기, (2) 저장소 변경 시 즉시 반영
  const refreshIfVisible = () => {
    if (document.visibilityState !== 'visible') return;
    loadDataAndRender();
  };

  setInterval(refreshIfVisible, DASHBOARD_REFRESH_INTERVAL_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshIfVisible();
  });

  let storageRefreshTimer = null;
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (document.visibilityState !== 'visible') return;

    // 잦은 stats 업데이트로 렌더가 과도해지는 걸 막기 위해 디바운스합니다.
    if (storageRefreshTimer) clearTimeout(storageRefreshTimer);
    storageRefreshTimer = setTimeout(() => {
      storageRefreshTimer = null;
      refreshIfVisible();
    }, 150);
  });
});
