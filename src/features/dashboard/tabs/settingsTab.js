import {
  CONFIG_DEFAULT_FILTER_SETTINGS,
  clampFilterStep,
  getFilterStepValue,
  materializeFilterSettings,
} from '../../../shared/config/index.js';
import { loadTextContent } from '../../../shared/utils/fileLoader.js';

const SETTINGS_PREVIEW_TEXT_PATH = 'samples/texts/text_sample_1.txt';
const SETTINGS_PREVIEW_TEXT_FALLBACK = '샘플 텍스트를 불러오지 못했습니다';

const SETTINGS_PREVIEW_MEDIA_VARIANTS = [
  {
    type: 'image',
    url: 'samples/images/rat-dance.gif',
    audioUrl: 'samples/sounds/rat-dance-music.mp3',
    label: 'rat-dance',
  },
  {
    type: 'image',
    url: 'samples/images/vibin-cheese-dance.gif',
    audioUrl: 'samples/sounds/vibin-cheese-dance-music.mp3',
    label: 'vibin-cheese-dance',
  },
];

const DEFAULT_NUDGE_AUTO_CONFIG = {
  enabled: false,
  thresholdMs: 30 * 60 * 1000,
};

function resolveAssetUrl(path) {
  if (!path) return '';
  if (typeof chrome !== 'undefined' && chrome?.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return path;
}

const ADVANCED_TIER = 'advanced';
const ADVANCED_TOGGLE_STORAGE_PREFIX = 'settingsAdvancedOpen:';

function formatStepDisplay(key, step) {
  const clamped = clampFilterStep(step);
  const nonZero = clamped <= 0 ? 1 : clamped;
  const physical = formatStepPhysicalValue(key, nonZero);
  if (!physical) return `Lv${nonZero}`;
  return `Lv${nonZero} · ${physical}`;
}

function formatStepPhysicalValue(key, step) {
  const value = getFilterStepValue(key, clampFilterStep(step));
  if (value === null || value === undefined) return '';
  if (key === 'clickDelay') {
    const seconds = Number(value) / 1000;
    if (!Number.isFinite(seconds)) return String(value);
    const label = seconds.toFixed(1).replace(/\.0$/, '');
    return `${label}s`;
  }
  if (key === 'scrollFriction') {
    const ms = Number(value);
    if (!Number.isFinite(ms)) return String(value);
    return `${Math.round(ms)}ms`;
  }
  if (key === 'saturation' || key === 'textOpacity') {
    const ratio = Number(value);
    if (!Number.isFinite(ratio)) return String(value);
    return `${Math.round(ratio * 100)}%`;
  }
  return String(value);
}

const SETTING_METADATA_V2 = {
  videoSkipGuard: {
    label: '비디오 스킵 제한',
    control: 'toggle',
    type: 'boolean',
    unit: '',
    unitSuffix: '',
    storage: 'raw',
    category: 'media',
    tier: 'advanced',
    order: 5,
    helper: '영상에서 앞으로 점프하려면 스킵권이 필요하게됨. 스킵권은 시간에 따라 충전됨.'
  },
  blur: {
    label: '블러',
    control: 'range',
    type: 'number',
    unit: '',
    unitSuffix: '',
    storage: 'step',
    category: 'media',
    tier: 'basic',
    order: 10,
    min: '1',
    max: '3',
    step: '1',
    displayValue: (inputValue) => formatStepDisplay('blur', inputValue),
  },
  saturation: {
    label: '채도 감소',
    control: 'range',
    type: 'number',
    unit: '',
    unitSuffix: '',
    storage: 'step',
    category: 'media',
    tier: 'basic',
    order: 20,
    min: '1',
    max: '3',
    step: '1',
    displayValue: (inputValue) => formatStepDisplay('saturation', inputValue),
  },
  letterSpacing: {
    label: '글자 간격',
    control: 'range',
    type: 'number',
    unit: '',
    unitSuffix: '',
    storage: 'step',
    category: 'text',
    tier: 'basic',
    order: 10,
    min: '1',
    max: '3',
    step: '1',
    displayValue: (inputValue) => formatStepDisplay('letterSpacing', inputValue),
  },
  textOpacity: {
    label: '글자 투명도',
    control: 'range',
    type: 'number',
    unit: '',
    unitSuffix: '',
    storage: 'step',
    category: 'text',
    tier: 'basic',
    order: 20,
    min: '1',
    max: '3',
    step: '1',
    displayValue: (inputValue) => formatStepDisplay('textOpacity', inputValue),
  },
  textShadow: { label: '텍스트 그림자', control: 'text', type: 'text', unit: '', unitSuffix: '', storage: 'raw', category: 'text', tier: 'advanced', order: 30, placeholder: '예: 0 1px 0 rgba(0,0,0,0.25)' },
  textShuffle: {
    label: '텍스트 셔플 강도',
    control: 'toggle',
    type: 'boolean',
    unit: '',
    unitSuffix: '',
    storage: 'raw',
    category: 'text',
    tier: 'advanced',
    order: 40,
    helper: 'Shuffle text on/off.',
  },
  socialEngagement: {
    label: '사회적 지표 숨김',
    control: 'toggle',
    type: 'boolean',
    unit: '',
    unitSuffix: '',
    storage: 'raw',
    category: 'misc',
    tier: 'basic',
    order: 10,
    helper: '좋아요/리포스트/댓글 좋아요 등 반응 지표를 숨깁니다.',
  },
  socialExposure: {
    label: '노출·신선도 지표 숨김',
    control: 'toggle',
    type: 'boolean',
    unit: '',
    unitSuffix: '',
    storage: 'raw',
    category: 'misc',
    tier: 'basic',
    order: 20,
    helper: '조회수/업로드 시간 등 노출·신선도 지표를 숨깁니다.',
  },
  delay: { label: '반응 지연', control: 'range', type: 'number', unit: 's', unitSuffix: 's', storage: 'secondsCss', category: 'delay', tier: 'advanced', order: 40, placeholder: '0.5', min: '0', max: '2.0', step: '0.1' },
  clickDelay: {
    label: 'Click Delay',
    control: 'range',
    type: 'number',
    unit: '',
    unitSuffix: '',
    storage: 'step',
    category: 'delay',
    tier: 'basic',
    order: 10,
    min: '1',
    max: '3',
    step: '1',
    displayValue: (inputValue) => formatStepDisplay('clickDelay', inputValue),
  },
  scrollFriction: {
    label: 'Scroll Batching',
    control: 'range',
    type: 'number',
    unit: '',
    unitSuffix: '',
    storage: 'step',
    category: 'delay',
    tier: 'basic',
    order: 20,
    min: '1',
    max: '3',
    step: '1',
    displayValue: (inputValue) => formatStepDisplay('scrollFriction', inputValue),
  },
  inputDelay: { label: '입력 지연', control: 'range', type: 'number', unit: 'ms', unitSuffix: 'ms', storage: 'ms', category: 'delay', tier: 'advanced', order: 30, placeholder: '120', min: '0', max: '500', step: '10' },
};

function pickRandom(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)];
}

function valueForInputV2(meta, storedValue) {
  const value = storedValue ?? '';

  if (typeof meta?.fromStorage === 'function') return meta.fromStorage(value);

  if (meta.storage === 'ms') {
    if (typeof value === 'number') return value;
    const n = parseInt(String(value), 10);
    return Number.isFinite(n) ? n : 0;
  }

  if (meta.storage === 'step') {
    const n = parseInt(String(value), 10);
    const clamped = Number.isFinite(n) ? clampFilterStep(n) : 1;
    return clamped <= 0 ? 1 : clamped;
  }

  if (meta.storage === 'raw') return String(value);

  if (meta.storage === 'secondsCss') {
    if (typeof value === 'number') return value;
    const s = String(value);
    const match = s.match(/-?\d+(\.\d+)?/);
    const n = match ? parseFloat(match[0]) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  if (meta.storage === 'cssUnit') {
    const s = String(value);
    if (meta.unitSuffix && s.endsWith(meta.unitSuffix)) return s.slice(0, -meta.unitSuffix.length);
    const match = s.match(/^-?(\d*\.)?\d+/);
    return match ? match[0] : '';
  }

  if (meta.storage === 'numberString') {
    if (typeof value === 'number') return value;
    const n = parseFloat(String(value));
    return Number.isFinite(n) ? n : '';
  }

  if (meta.storage === 'number') {
    const n = parseFloat(String(value));
    return Number.isFinite(n) ? n : 0;
  }

  return String(value);
}

function valueForStorageV2(_key, meta, inputValue) {
  const raw = inputValue ?? '';

  if (typeof meta?.toStorage === 'function') return meta.toStorage(raw);

  if (meta.storage === 'ms') return parseInt(String(raw), 10) || 0;
  if (meta.storage === 'step') {
    const clamped = clampFilterStep(parseInt(String(raw), 10) || 0);
    return clamped <= 0 ? 1 : clamped;
  }
  if (meta.storage === 'raw') return String(raw);
  if (meta.storage === 'secondsCss') {
    const num = parseFloat(String(raw)) || 0;
    const unit = meta.unitSuffix || meta.unit || 's';
    return `${num}${unit}`;
  }
  if (meta.storage === 'cssUnit') {
    const unit = meta.unitSuffix || meta.unit || '';
    return `${raw}${unit}`;
  }
  if (meta.storage === 'numberString') {
    const n = parseFloat(String(raw));
    if (!Number.isFinite(n)) return '';
    return String(n);
  }
  if (meta.storage === 'number') {
    const n = parseFloat(String(raw));
    return Number.isFinite(n) ? n : 0;
  }

  return raw;
}

function getTextShuffleProbability(settings) {
  if (!settings?.textShuffle?.isActive) return 0;
  const v = parseFloat(String(settings.textShuffle.value ?? 0));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

function seededShuffleWords(text, seedStr, strength = 1) {
  const original = String(text || '');
  const s = Math.max(0, Math.min(1, strength || 0));
  if (s <= 0) return original;

  const parts = original.split(/(\s+)/);
  const wordSlots = [];
  const words = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    if (/^\s+$/.test(part)) continue;
    wordSlots.push(i);
    words.push(part);
  }

  if (words.length <= 3) return original;

  let seed = 0;
  const seedSource = String(seedStr || '');
  for (let i = 0; i < seedSource.length; i++) seed = (seed * 31 + seedSource.charCodeAt(i)) >>> 0;

  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const nextInt = (max) => (max > 0 ? Math.floor(nextRand() * max) : 0);

  const outWords = words.slice();
  const n = outWords.length;
  const kMax = Math.min(25, Math.floor(n / 2));
  const k = Math.max(1, Math.round(s * kMax));
  const swapChance = Math.min(1, s * 1.2);
  const passes = s >= 0.85 ? 2 : 1;

  for (let pass = 0; pass < passes; pass++) {
    for (let i = 0; i < n; i++) {
      if (nextRand() > swapChance) continue;
      const offset = nextInt(2 * k + 1) - k;
      if (offset === 0) continue;
      const j = Math.max(0, Math.min(n - 1, i + offset));
      if (j === i) continue;
      [outWords[i], outWords[j]] = [outWords[j], outWords[i]];
    }
  }

  for (let i = 0; i < wordSlots.length; i++) {
    parts[wordSlots[i]] = outWords[i] ?? parts[wordSlots[i]];
  }

  return parts.join('');
}

export function createSettingsTab({ UI, getSettings, setSettings, mergeFilterSettings }) {
  let currentSettingsSubtab = 'media';

  let selectedMediaPreviewVariant = null;
  let settingsPreviewTextPromise = null;
  let settingsPreviewTextCache = null;
  let settingsPreviewAudioEl = null;
  let settingsPreviewUpdateToken = 0;
  let audioFadeToken = 0;

  function storageGet(defaults) {
    return new Promise((resolve) => {
      chrome.storage.local.get(defaults || {}, (items) => resolve(items || {}));
    });
  }

  function storageSet(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items || {}, () => resolve());
    });
  }

  function readAdvancedOpenState(tabKey) {
    try {
      const raw = localStorage.getItem(`${ADVANCED_TOGGLE_STORAGE_PREFIX}${tabKey}`);
      if (raw === null) return null;
      return raw === '1';
    } catch (_) {
      return null;
    }
  }

  function writeAdvancedOpenState(tabKey, isOpen) {
    try {
      localStorage.setItem(`${ADVANCED_TOGGLE_STORAGE_PREFIX}${tabKey}`, isOpen ? '1' : '0');
    } catch (_) {}
  }

  function normalizeNudgeAutoConfig(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const enabled = typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_NUDGE_AUTO_CONFIG.enabled;
    const thresholdMsRaw = Number(src.thresholdMs);
    const thresholdMs = Number.isFinite(thresholdMsRaw) ? Math.max(0, thresholdMsRaw) : DEFAULT_NUDGE_AUTO_CONFIG.thresholdMs;
    return { enabled, thresholdMs };
  }

  function minutesFromMs(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return 30;
    return Math.max(5, Math.min(240, Math.round(n / 60000)));
  }

  function syncNudgeAutoUI(config) {
    if (!UI.nudgeAutoToggle || !UI.nudgeAutoThresholdRange) return;

    UI.nudgeAutoToggle.checked = !!config.enabled;

    const minutes = minutesFromMs(config.thresholdMs);
    UI.nudgeAutoThresholdRange.value = String(minutes);
    UI.nudgeAutoThresholdRange.disabled = !config.enabled;

    if (UI.nudgeAutoToggleOutput) UI.nudgeAutoToggleOutput.textContent = config.enabled ? 'ON' : 'OFF';
    if (UI.nudgeAutoThresholdOutput) UI.nudgeAutoThresholdOutput.textContent = `${minutes}분`;
  }

  async function loadNudgeAutoConfigAndSyncUI() {
    const items = await storageGet({ nudgeConfig: {} });
    const config = normalizeNudgeAutoConfig(items.nudgeConfig);
    syncNudgeAutoUI(config);
    return config;
  }

  async function updateNudgeAutoConfig(patch) {
    const items = await storageGet({ nudgeConfig: {} });
    const current = normalizeNudgeAutoConfig(items.nudgeConfig);

    const enabled = typeof patch?.enabled === 'boolean' ? patch.enabled : current.enabled;
    const thresholdMsRaw = patch && patch.thresholdMs !== undefined ? Number(patch.thresholdMs) : current.thresholdMs;
    const thresholdMs = Number.isFinite(thresholdMsRaw) ? Math.max(0, thresholdMsRaw) : current.thresholdMs;

    const next = {
      ...(items.nudgeConfig && typeof items.nudgeConfig === 'object' ? items.nudgeConfig : {}),
      enabled,
      thresholdMs,
    };

    await storageSet({ nudgeConfig: next });
    chrome.runtime.sendMessage({ action: 'NUDGE_CONFIG_UPDATED' });

    const normalized = normalizeNudgeAutoConfig(next);
    syncNudgeAutoUI(normalized);
    return normalized;
  }

  function ensurePreviewAudioEl() {
    if (settingsPreviewAudioEl) return settingsPreviewAudioEl;
    if (!UI.settingsPreview) return null;

    settingsPreviewAudioEl = UI.settingsPreview.querySelector('audio[data-settings-preview-audio="true"]');
    if (settingsPreviewAudioEl) return settingsPreviewAudioEl;

    settingsPreviewAudioEl = document.createElement('audio');
    settingsPreviewAudioEl.dataset.settingsPreviewAudio = 'true';
    settingsPreviewAudioEl.preload = 'auto';
    settingsPreviewAudioEl.loop = true;
    settingsPreviewAudioEl.volume = 0;
    settingsPreviewAudioEl.style.display = 'none';
    UI.settingsPreview.appendChild(settingsPreviewAudioEl);
    return settingsPreviewAudioEl;
  }

  function fadeMediaPreviewAudioTo(targetVolume, { pauseAtEnd = false } = {}) {
    const audio = ensurePreviewAudioEl();
    if (!audio) return;

    const fromRaw = Number(audio.volume);
    const from = Number.isFinite(fromRaw) ? Math.max(0, Math.min(1, fromRaw)) : 0;
    const to = Math.max(0, Math.min(1, Number(targetVolume) || 0));
    const duration = 180;
    const start = performance.now();
    const token = ++audioFadeToken;

    if (to > 0 && audio.paused) {
      audio.currentTime = 0;
      audio.play().catch(() => {});
    }

    function step(now) {
      if (token !== audioFadeToken) return;
      const t = Math.min(1, (now - start) / duration);
      const nextVolume = Math.max(0, Math.min(1, from + (to - from) * t));
      audio.volume = nextVolume;
      if (t < 1) requestAnimationFrame(step);
      else if (pauseAtEnd && to === 0) audio.pause();
    }

    requestAnimationFrame(step);
  }

  function setupMediaPreviewHoverAudio() {
    if (!UI.settingsPreview) return;
    ensurePreviewAudioEl();

    UI.settingsPreview.addEventListener('mouseenter', () => {
      if (currentSettingsSubtab !== 'media') return;
      fadeMediaPreviewAudioTo(1);
    });

    UI.settingsPreview.addEventListener('mouseleave', () => {
      fadeMediaPreviewAudioTo(0, { pauseAtEnd: true });
    });
  }

  function syncSettingCardUIV2(card) {
    const key = card?.dataset?.key;
    if (!key || !SETTING_METADATA_V2[key]) return;
    const meta = SETTING_METADATA_V2[key];

    const toggle = card.querySelector('.toggle-active');
    const input = card.querySelector('.input-value');
    const output = card.querySelector('.setting-output');
    const levelBadge = card.querySelector('[data-level-badge="true"]');
    const isActive = !!toggle?.checked;

    if (input) input.disabled = !isActive;
    card.classList.toggle('is-disabled', !isActive);

    const raw = input?.value ?? '';

    if (meta.storage === 'step') {
      const step = clampFilterStep(parseInt(String(raw), 10) || 0) || 1;
      const nonZeroStep = step <= 0 ? 1 : step;
      card.dataset.step = String(nonZeroStep);
      card.style.setProperty('--range-accent', isActive ? `var(--level-${nonZeroStep})` : 'var(--border-color)');
      card.style.setProperty('--range-progress', isActive ? `${((nonZeroStep - 1) / 2) * 100}%` : '0%');

      if (levelBadge) {
        const physical = formatStepPhysicalValue(key, nonZeroStep) || '';
        levelBadge.textContent = isActive ? `Lv${nonZeroStep}` : 'OFF';
        levelBadge.title = isActive ? physical : `최근: Lv${nonZeroStep}${physical ? ` · ${physical}` : ''}`;
      }
    } else {
      card.dataset.step = '';
      card.style.removeProperty('--range-progress');
      card.style.removeProperty('--range-accent');
    }

    if (!output) return;
    if (!isActive) {
      output.textContent = 'OFF';
      return;
    }
    const valueLabel =
      typeof meta.displayValue === 'function'
        ? meta.displayValue(raw)
        : meta.control === 'range'
          ? `${raw}${meta.unitSuffix || meta.unit || ''}`
          : `${meta.unitSuffix || meta.unit || ''}`;

    output.textContent = valueLabel;
  }

  function collectSettingsFromGridV2() {
    const next = { ...(getSettings() || {}) };

    const cards = UI.settingsGrid ? UI.settingsGrid.querySelectorAll('.setting-card') : [];
    cards.forEach((card) => {
      const toggle = card.querySelector('.toggle-active');
      const key = toggle?.dataset?.key;
      if (!key || !SETTING_METADATA_V2[key]) return;

      const meta = SETTING_METADATA_V2[key];
      const input = card.querySelector('.input-value');
      let value = input ? valueForStorageV2(key, meta, input?.value) : next[key]?.value;
      if (value === undefined) value = CONFIG_DEFAULT_FILTER_SETTINGS[key]?.value ?? '';

      next[key] = {
        isActive: !!toggle.checked,
        value,
      };
    });

    setSettings(next);
  }

  async function persistCurrentSettings() {
    const merged = mergeFilterSettings(getSettings());
    await storageSet({ filterSettings: merged });
    setSettings(merged);
    chrome.runtime.sendMessage({ action: 'SETTINGS_UPDATED' });
  }

  function syncSettingsSubtabUI() {
    if (!UI.settingsSubtabButtons) return;
    UI.settingsSubtabButtons.forEach((btn) => {
      const isActive = btn.dataset.settingsSubtab === currentSettingsSubtab;
      btn.classList.toggle('is-active', isActive);
      btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });
  }

  function applySettingsSubtabVisibility() {
    const isGame = currentSettingsSubtab === 'game';
    if (UI.nudgeDebugPanel) UI.nudgeDebugPanel.classList.toggle('is-hidden', !isGame);
    if (UI.settingsPreview) UI.settingsPreview.classList.toggle('is-hidden', isGame);
    if (UI.settingsGrid) UI.settingsGrid.classList.toggle('is-hidden', isGame);
  }

  function setActiveSettingsSubtabV2(next) {
    const nextTab = next === 'text' || next === 'delay' || next === 'misc' || next === 'game' ? next : 'media';
    if (currentSettingsSubtab === nextTab) return;

    collectSettingsFromGridV2();
    currentSettingsSubtab = nextTab;
    if (currentSettingsSubtab !== 'media') fadeMediaPreviewAudioTo(0, { pauseAtEnd: true });
    syncSettingsSubtabUI();
    display();
  }

  function syncNudgeDebugOutputs() {
    const size = parseInt(UI.nudgeSizeRange?.value || '96', 10) || 96;
    const speed = parseInt(UI.nudgeSpeedRange?.value || '140', 10) || 140;
    const interval = parseInt(UI.nudgeSpawnIntervalRange?.value || '4000', 10) || 4000;
    const maxSprites = parseInt(UI.nudgeMaxSpritesRange?.value || '6', 10) || 6;
    const ramp = parseFloat(UI.nudgeSpeedRampRange?.value || '1.15') || 1.15;

    if (UI.nudgeSizeOutput) UI.nudgeSizeOutput.textContent = `${size}px`;
    if (UI.nudgeSpeedOutput) UI.nudgeSpeedOutput.textContent = `${speed}`;
    if (UI.nudgeSpawnIntervalOutput) UI.nudgeSpawnIntervalOutput.textContent = `${interval}ms`;
    if (UI.nudgeMaxSpritesOutput) UI.nudgeMaxSpritesOutput.textContent = `${maxSprites}`;
    if (UI.nudgeSpeedRampOutput) UI.nudgeSpeedRampOutput.textContent = `${ramp.toFixed(2)}x`;
  }

  function getNudgeDebugConfigFromUI() {
    const size = parseInt(UI.nudgeSizeRange?.value || '96', 10) || 96;
    const speed = parseInt(UI.nudgeSpeedRange?.value || '140', 10) || 140;
    const interval = parseInt(UI.nudgeSpawnIntervalRange?.value || '4000', 10) || 4000;
    const maxSprites = parseInt(UI.nudgeMaxSpritesRange?.value || '6', 10) || 6;
    const ramp = parseFloat(UI.nudgeSpeedRampRange?.value || '1.15') || 1.15;

    return {
      spriteSizePx: size,
      baseSpeedPxPerSec: speed,
      spawnIntervalMs: interval,
      maxSprites,
      speedRamp: ramp,
      asset: {
        gifPath: 'samples/images/nudge-object.gif',
        audioPath: 'samples/sounds/nudge-music.mp3',
        label: 'nudge-object',
      },
      message: {
        title: '잠깐!',
        body: '늘 차단 중이에요. 무례했거나 불편함으로 돌아가세요.',
      },
    };
  }

  function setNudgeDebugStatus(text) {
    if (UI.nudgeDebugStatus) UI.nudgeDebugStatus.textContent = text || '';
  }

  function getLastActiveTabId() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'DEBUG_GET_CACHE' }, (resp) => {
        resolve(resp?.lastActiveTab ?? null);
      });
    });
  }

  function getTab(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => resolve(tab || null));
    });
  }

  function queryTabs(queryInfo) {
    return new Promise((resolve) => {
      chrome.tabs.query(queryInfo, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
    });
  }

  function isWebUrl(url) {
    return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
  }

  async function resolveTargetTabId() {
    const lastId = await getLastActiveTabId();
    if (typeof lastId === 'number') {
      const tab = await getTab(lastId);
      if (tab && isWebUrl(tab.url)) return lastId;
    }

    const tabs = await queryTabs({ lastFocusedWindow: true });
    const candidate = tabs.find((t) => isWebUrl(t.url));
    return candidate?.id ?? null;
  }

  async function sendNudgeDebugMessage(message) {
    const tabId = await resolveTargetTabId();
    if (!tabId) {
      setNudgeDebugStatus('탭을 찾지 못했어요.');
      return;
    }

    const trySend = () =>
      new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, message, () => {
          const err = chrome.runtime.lastError?.message;
          resolve(err || null);
        });
      });

    const tryInject = () =>
      new Promise((resolve) => {
        chrome.scripting.executeScript(
          {
            target: { tabId },
            files: ['entries/content/earlyApplyLoader.js', 'entries/content/loader.js'],
          },
          () => {
            const err = chrome.runtime.lastError?.message;
            resolve(err || null);
          }
        );
      });

    const err1 = await trySend();
    if (!err1) {
      setNudgeDebugStatus(`전송 완료 (tabId: ${tabId})`);
      return;
    }

    if (String(err1).includes('Receiving end does not exist')) {
      setNudgeDebugStatus('콘텐츠스크립트가 아직 주입 중입니다...');
      const injectErr = await tryInject();
      if (injectErr) {
        setNudgeDebugStatus(`주입 실패: ${injectErr}`);
        return;
      }

      const err2 = await trySend();
      if (err2) {
        setNudgeDebugStatus(`전송 실패: ${err2}`);
        return;
      }

      setNudgeDebugStatus(`전송 완료 (주입 후) (tabId: ${tabId})`);
      return;
    }

    setNudgeDebugStatus(`전송 실패: ${err1}`);
  }

  function ensurePreviewMediaVariant() {
    if (selectedMediaPreviewVariant) return selectedMediaPreviewVariant;
    selectedMediaPreviewVariant = pickRandom(SETTINGS_PREVIEW_MEDIA_VARIANTS) || SETTINGS_PREVIEW_MEDIA_VARIANTS[0];
    return selectedMediaPreviewVariant;
  }

  async function ensurePreviewText() {
    if (settingsPreviewTextCache !== null) return settingsPreviewTextCache;
    if (settingsPreviewTextPromise) return settingsPreviewTextPromise;

    settingsPreviewTextPromise = loadTextContent(SETTINGS_PREVIEW_TEXT_PATH)
      .then((t) => {
        const normalized = String(t || '').trim();
        settingsPreviewTextCache = normalized || SETTINGS_PREVIEW_TEXT_FALLBACK;
        return settingsPreviewTextCache;
      })
      .catch(() => {
        settingsPreviewTextCache = SETTINGS_PREVIEW_TEXT_FALLBACK;
        return settingsPreviewTextCache;
      });

    return settingsPreviewTextPromise;
  }

  function clearFrames() {
    if (UI.previewBefore) UI.previewBefore.innerHTML = '';
    if (UI.previewAfter) UI.previewAfter.innerHTML = '';
  }

  function createSettingCard(key, meta, setting) {
    const inputValue = valueForInputV2(meta, setting.value);
    const inputId = `setting-${key}`;
    const isToggleOnly = meta.control === 'toggle';
    const control = meta.control === 'text' ? 'text' : 'range';
    const isActive = !!setting.isActive;
    const isStepRange = control === 'range' && meta.storage === 'step';

    const card = document.createElement('div');
    card.className = 'setting-card';
    card.dataset.key = key;
    if (isToggleOnly) card.classList.add('is-toggle-only');
    if (isStepRange) card.classList.add('is-stepped');
    const controlMarkup = isToggleOnly
      ? `<div class="setting-helper">${meta.helper || ''}</div>`
      : control === 'range'
        ? `
          <div class="setting-range-wrap ${isStepRange ? 'is-stepped' : ''}">
            <div class="setting-range-row">
              <input
                id="${inputId}"
                class="input-value input-range"
                data-key="${key}"
                type="range"
                value="${String(inputValue).replace(/\"/g, '&quot;')}"
                placeholder="${meta.placeholder || ''}"
                ${meta.min !== undefined ? `min="${meta.min}"` : ''}
                ${meta.max !== undefined ? `max="${meta.max}"` : ''}
                ${meta.step !== undefined ? `step="${meta.step}"` : ''}
                ${isActive ? '' : 'disabled'}
              >
            </div>
            ${
              !isStepRange
                ? `<output class="setting-output" for="${inputId}" aria-live="polite"></output>`
                : ''
            }
          </div>
        `
        : `
          <input
            id="${inputId}"
            class="input-value"
            data-key="${key}"
            type="${meta.type === 'number' ? 'number' : 'text'}"
            value="${String(inputValue).replace(/\"/g, '&quot;')}"
            placeholder="${meta.placeholder || ''}"
            ${meta.min ? `min="${meta.min}"` : ''}
            ${meta.step ? `step="${meta.step}"` : ''}
            ${isActive ? '' : 'disabled'}
            style="flex-grow: 1;"
          >
          <span class="setting-output">${meta.unitSuffix || meta.unit || ''}</span>
        `;
    card.innerHTML = `
      <div class="setting-header">
        <div class="setting-header-left">
          ${isStepRange ? '<span class="setting-level-badge" data-level-badge="true"></span>' : ''}
          <label for="${inputId}">${meta.label}</label>
        </div>
        <label class="switch">
          <input type="checkbox" class="toggle-active" data-key="${key}" ${isActive ? 'checked' : ''}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="setting-control">
        ${controlMarkup}
      </div>
    `;

    syncSettingCardUIV2(card);
    return card;
  }

  function splitEntriesByTier(entries) {
    const basic = [];
    const advanced = [];
    entries.forEach((entry) => {
      const meta = entry[1];
      if (meta?.tier === ADVANCED_TIER) advanced.push(entry);
      else basic.push(entry);
    });
    return { basic, advanced };
  }

  function countActiveEntries(entries, settings) {
    if (!entries.length) return 0;
    return entries.reduce((count, [key]) => count + (settings?.[key]?.isActive ? 1 : 0), 0);
  }

  function updateAdvancedBadge() {
    if (!UI.settingsGrid) return;
    const badge = UI.settingsGrid.querySelector('[data-settings-advanced-badge="true"]');
    if (!badge) return;
    const entries = Object.entries(SETTING_METADATA_V2)
      .filter(([, meta]) => meta.category === currentSettingsSubtab && meta?.tier === ADVANCED_TIER);
    const count = countActiveEntries(entries, getSettings());
    badge.textContent = count > 0 ? `활성 ${count}개` : '';
    badge.classList.toggle('is-hidden', count === 0);
  }

  async function updateSettingsPreviewV2() {
    if (!UI.settingsPreview || !UI.previewBefore || !UI.previewAfter) return;
    const settings = materializeFilterSettings(getSettings() || {});
    const token = ++settingsPreviewUpdateToken;

    clearFrames();

    if (currentSettingsSubtab === 'media') {
      if (UI.settingsPreviewDescription) {
        UI.settingsPreviewDescription.textContent =
          '왼쪽은 원본, 오른쪽은 현재 설정된 미디어 필터가 적용된 결과입니다.';
      }

      const variant = ensurePreviewMediaVariant();

      const audio = ensurePreviewAudioEl();
      if (audio) {
        const nextSrc = variant.audioUrl ? resolveAssetUrl(String(variant.audioUrl)) : '';
        if (nextSrc && audio.getAttribute('src') !== nextSrc) {
          audio.pause();
          audio.currentTime = 0;
          audio.setAttribute('src', nextSrc);
          audio.load();
        }
        audio.volume = 0;
      }

      const before = document.createElement('div');
      before.className = 'preview-media';
      const after = document.createElement('div');
      after.className = 'preview-media';

      const ib = document.createElement('img');
      ib.src = resolveAssetUrl(variant.url);
      ib.alt = variant.label;
      ib.className = 'preview-image';
      ib.decoding = 'async';

      const ia = ib.cloneNode(true);
      before.appendChild(ib);
      after.appendChild(ia);

      const filterParts = [];
      if (settings?.blur?.isActive) filterParts.push(`blur(${settings.blur.value})`);
      if (settings?.saturation?.isActive) filterParts.push(`saturate(${settings.saturation.value})`);
      if (filterParts.length > 0) {
        ia.style.filter = filterParts.join(' ');
        ia.style.willChange = 'filter';
      }

      UI.previewBefore.appendChild(before);
      UI.previewAfter.appendChild(after);
      return;
    }

    if (currentSettingsSubtab === 'text') {
      if (UI.settingsPreviewDescription) {
        UI.settingsPreviewDescription.textContent = '왼쪽은 원본, 오른쪽은 현재 설정된 텍스트 필터가 적용된 결과입니다.';
      }

      const originalText = await ensurePreviewText();
      if (token !== settingsPreviewUpdateToken) return;

      const before = document.createElement('div');
      before.className = 'preview-text';
      before.textContent = originalText;

      const after = document.createElement('div');
      after.className = 'preview-text';

      const strength = getTextShuffleProbability(settings);
      const shuffled = strength > 0 ? seededShuffleWords(originalText, `friction-preview-${strength}`, strength) : originalText;
      after.textContent = shuffled;

      if (settings?.letterSpacing?.isActive) after.style.letterSpacing = String(settings.letterSpacing.value);
      if (settings?.textOpacity?.isActive) {
        const opacity = parseFloat(String(settings.textOpacity.value));
        if (Number.isFinite(opacity)) after.style.opacity = String(opacity);
      }
      if (settings?.textShadow?.isActive) after.style.textShadow = String(settings.textShadow.value);

      UI.previewBefore.appendChild(before);
      UI.previewAfter.appendChild(after);
      return;
    }

    if (UI.settingsPreviewDescription) UI.settingsPreviewDescription.textContent = '지금은 미리보기가 없습니다.';
    const placeholderBefore = document.createElement('div');
    placeholderBefore.className = 'preview-placeholder';
    placeholderBefore.textContent = '미리 보기 없음';
    const placeholderAfter = document.createElement('div');
    placeholderAfter.className = 'preview-placeholder';
    placeholderAfter.textContent = '미리 보기 없음';
    UI.previewBefore.appendChild(placeholderBefore);
    UI.previewAfter.appendChild(placeholderAfter);
  }

  function displaySettingsV2() {
    if (!UI.settingsGrid) return;
    UI.settingsGrid.innerHTML = '';

    if (currentSettingsSubtab === 'misc') {
      const section = document.createElement('div');
      section.className = 'settings-section';
      section.innerHTML = `
        <div class="settings-section-title">소셜 매트릭스 필터</div>
        <div class="settings-section-desc">좋아요, 조회수, 업로드 시간 같은 숫자 지표를 숨깁니다. 추후 숏폼 끄기 같은 실험 옵션도 여기에 추가됩니다.</div>
      `;
      UI.settingsGrid.appendChild(section);
    }

    const entries = Object.entries(SETTING_METADATA_V2)
      .filter(([, meta]) => meta.category === currentSettingsSubtab)
      .sort((a, b) => (a[1].order || 0) - (b[1].order || 0));

    const settings = getSettings() || {};
    const { basic, advanced } = splitEntriesByTier(entries);

    const basicGroup = document.createElement('div');
    basicGroup.className = 'settings-group settings-group-basic';
    basicGroup.innerHTML = `
      <div class="settings-group-header">
        <span class="settings-group-title">기본</span>
      </div>
      <div class="settings-group-grid"></div>
    `;
    const basicGrid = basicGroup.querySelector('.settings-group-grid');
    basic.forEach(([key, meta]) => {
      const setting = settings[key] || CONFIG_DEFAULT_FILTER_SETTINGS[key] || { isActive: false, value: '' };
      basicGrid.appendChild(createSettingCard(key, meta, setting));
    });
    UI.settingsGrid.appendChild(basicGroup);

    if (advanced.length > 0) {
      const activeCount = countActiveEntries(advanced, settings);
      const storedOpen = readAdvancedOpenState(currentSettingsSubtab);
      const shouldOpen = storedOpen !== null ? storedOpen : activeCount > 0;

      const advancedGroup = document.createElement('details');
      advancedGroup.className = 'settings-group settings-group-advanced';
      advancedGroup.open = shouldOpen;
      advancedGroup.innerHTML = `
        <summary class="settings-group-summary">
          <span class="settings-group-title">고급 옵션</span>
          <span class="settings-group-badge ${activeCount > 0 ? '' : 'is-hidden'}" data-settings-advanced-badge="true">
            ${activeCount > 0 ? `활성 ${activeCount}개` : ''}
          </span>
        </summary>
        <div class="settings-group-grid"></div>
      `;

      const advancedGrid = advancedGroup.querySelector('.settings-group-grid');
      advanced.forEach(([key, meta]) => {
        const setting = settings[key] || CONFIG_DEFAULT_FILTER_SETTINGS[key] || { isActive: false, value: '' };
        advancedGrid.appendChild(createSettingCard(key, meta, setting));
      });

      advancedGroup.addEventListener('toggle', () => {
        writeAdvancedOpenState(currentSettingsSubtab, advancedGroup.open);
      });

      UI.settingsGrid.appendChild(advancedGroup);
    }
  }

  function setup() {
    setupMediaPreviewHoverAudio();

    if (UI.settingsSubtabButtons) {
      UI.settingsSubtabButtons.forEach((btn) => {
        btn.addEventListener('click', () => setActiveSettingsSubtabV2(btn.dataset.settingsSubtab));
      });
      syncSettingsSubtabUI();
    }

    if (UI.settingsGrid) {
      UI.settingsGrid.addEventListener('change', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const card = target.closest('.setting-card');
        if (!card) return;

        if (target.classList.contains('toggle-active')) {
          syncSettingCardUIV2(card);
          collectSettingsFromGridV2();
          updateSettingsPreviewV2();
          updateAdvancedBadge();
          persistCurrentSettings().catch(() => {});
          return;
        }

        if (target.classList.contains('input-value')) {
          syncSettingCardUIV2(card);
          collectSettingsFromGridV2();
          updateSettingsPreviewV2();
          persistCurrentSettings().catch(() => {});
        }
      });

      UI.settingsGrid.addEventListener('input', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const card = target.closest('.setting-card');
        if (!card) return;

        if (target.classList.contains('input-value')) {
          syncSettingCardUIV2(card);
          collectSettingsFromGridV2();
          updateSettingsPreviewV2();
        }
      });
    }

    if (UI.nudgeDebugPanel) {
      if (UI.nudgeAutoToggle && UI.nudgeAutoThresholdRange) {
        UI.nudgeAutoToggle.addEventListener('change', async () => {
          const enabled = !!UI.nudgeAutoToggle.checked;
          const next = await updateNudgeAutoConfig({ enabled });
          setNudgeDebugStatus(`자동 개입: ${next.enabled ? 'ON' : 'OFF'}`);
        });

        UI.nudgeAutoThresholdRange.addEventListener('input', () => {
          const minutes = parseInt(String(UI.nudgeAutoThresholdRange.value || '30'), 10) || 30;
          if (UI.nudgeAutoThresholdOutput) UI.nudgeAutoThresholdOutput.textContent = `${minutes}분`;
        });

        UI.nudgeAutoThresholdRange.addEventListener('change', async () => {
          const minutes = parseInt(String(UI.nudgeAutoThresholdRange.value || '30'), 10) || 30;
          const next = await updateNudgeAutoConfig({ thresholdMs: minutes * 60 * 1000 });
          setNudgeDebugStatus(`자동 개입 기준: ${minutesFromMs(next.thresholdMs)}분`);
        });
      }

      const syncAndPush = () => {
        syncNudgeDebugOutputs();
        if (currentSettingsSubtab !== 'game') return;
        const config = getNudgeDebugConfigFromUI();
        sendNudgeDebugMessage({ type: 'NUDGE_DEBUG_CONFIG', payload: { config } }).catch(() => {});
      };

      UI.nudgeSizeRange?.addEventListener('input', syncAndPush);
      UI.nudgeSpeedRange?.addEventListener('input', syncAndPush);
      UI.nudgeSpawnIntervalRange?.addEventListener('input', syncAndPush);
      UI.nudgeMaxSpritesRange?.addEventListener('input', syncAndPush);
      UI.nudgeSpeedRampRange?.addEventListener('input', syncAndPush);

      UI.nudgeSpawnBtn?.addEventListener('click', () => {
        syncNudgeDebugOutputs();
        const config = getNudgeDebugConfigFromUI();
        sendNudgeDebugMessage({ type: 'NUDGE_DEBUG_SPAWN', payload: { config } }).catch(() => {});
      });

      UI.nudgeStopBtn?.addEventListener('click', () => {
        sendNudgeDebugMessage({ type: 'NUDGE_STOP' }).catch(() => {});
      });
    }
  }

  async function display() {
    syncSettingsSubtabUI();
    applySettingsSubtabVisibility();

    if (currentSettingsSubtab === 'game') {
      syncNudgeDebugOutputs();
      // 미리보기 최신 설정 반영
      await loadNudgeAutoConfigAndSyncUI();
      return;
    }

    displaySettingsV2();
    await updateSettingsPreviewV2();
  }

  function beforeLeave() {
    collectSettingsFromGridV2();
    persistCurrentSettings().catch(() => {});
    fadeMediaPreviewAudioTo(0, { pauseAtEnd: true });
  }

  return { setup, display, beforeLeave, setActiveSettingsSubtabV2 };
}
