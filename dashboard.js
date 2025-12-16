import { CONFIG_DEFAULT_FILTER_SETTINGS } from './config.js';
import { createOverviewTab } from './dashboard/tabs/overviewTab.js';
import { createDetailedRecapTab } from './dashboard/tabs/detailedRecapTab.js';
import { createBlocklistTab } from './dashboard/tabs/blocklistTab.js';
import { createSettingsTab } from './dashboard/tabs/settingsTab.js';
import { createScheduleTab } from './dashboard/tabs/scheduleTab.js';

let currentStats = { dates: {} };
let currentBlockedUrls = [];
let currentSettings = {};
let currentSchedule = { scheduleActive: false, startMin: 0, endMin: 1440 };

let overviewTab = null;
let detailedRecapTab = null;
let blocklistTab = null;
let settingsTab = null;
let scheduleTab = null;

const UI = {};

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
  UI.weeklyTotal = document.getElementById('weeklyTotal');
  UI.weeklyBlocked = document.getElementById('weeklyBlocked');
  UI.weeklyChange = document.getElementById('weeklyChange');
  UI.weeklyGraph = document.getElementById('weeklyGraph');
  UI.weeklyInsight = document.getElementById('weeklyInsight');

  UI.blockedListDisplay = document.getElementById('blockedListDisplay');
  UI.newBlockUrlInput = document.getElementById('newBlockUrl');
  UI.addBlockBtn = document.getElementById('addBlockBtn');

  UI.settingsGrid = document.querySelector('.settings-grid');
  UI.settingsSubtabButtons = document.querySelectorAll('.settings-subtab-btn');
  UI.saveSettingsBtn = document.getElementById('saveSettingsBtn');
  UI.saveStatus = document.getElementById('saveStatus');
  UI.settingsPreview = document.getElementById('settingsPreview');
  UI.settingsPreviewDescription = document.getElementById('settingsPreviewDescription');
  UI.previewBefore = document.getElementById('previewBefore');
  UI.previewAfter = document.getElementById('previewAfter');
  UI.settingsSaveCard = document.getElementById('settingsSaveCard');

  UI.nudgeDebugPanel = document.getElementById('nudgeDebugPanel');
  UI.nudgeSpawnBtn = document.getElementById('nudgeSpawnBtn');
  UI.nudgeStopBtn = document.getElementById('nudgeStopBtn');
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

  overviewTab = createOverviewTab({
    UI,
    getState: () => ({ currentStats, currentBlockedUrls }),
    onToggleBlockDomain: toggleBlockDomain,
  });
  detailedRecapTab = createDetailedRecapTab({
    UI,
    getState: () => ({ currentStats, currentBlockedUrls }),
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
});
