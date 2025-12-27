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

function resolveAssetUrl(path) {
  if (!path) return '';
  if (typeof chrome !== 'undefined' && chrome?.runtime?.getURL) {
    return chrome.runtime.getURL(path);
  }
  return path;
}

const EXPERIMENTAL_TIER = 'experimental';
const SETTINGS_EXPERIMENTAL_KEY = 'settingsShowExperimental';
const INDICATOR_CONFIG_KEY = 'indicatorConfig';
const INDICATOR_CONFIG_DEFAULT = { enabled: true };

function isExperimentalSettingsEnabled() {
  try {
    return localStorage.getItem(SETTINGS_EXPERIMENTAL_KEY) === '1';
  } catch (_) {
    return false;
  }
}

function normalizeIndicatorConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const enabled = typeof src.enabled === 'boolean' ? src.enabled : INDICATOR_CONFIG_DEFAULT.enabled;
  return { ...INDICATOR_CONFIG_DEFAULT, ...src, enabled };
}

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
  textShadow: { label: '텍스트 그림자', control: 'shadow', type: 'shadow', unit: '', unitSuffix: '', storage: 'raw', category: 'text', tier: 'advanced', order: 30 },
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
  inputDelay: { label: '입력 지연', control: 'range', type: 'number', unit: 'ms', unitSuffix: 'ms', storage: 'ms', category: 'delay', tier: EXPERIMENTAL_TIER, order: 30, placeholder: '120', min: '0', max: '500', step: '10' },
};

const SETTINGS_CATEGORY_ORDER = [
  { key: 'media', label: '미디어 필터' },
  { key: 'text', label: '텍스트 필터' },
  { key: 'delay', label: '딜레이 필터' },
  {
    key: 'misc',
    label: '기타',
    description: '좋아요, 조회수, 업로드 시간 같은 숫자 지표를 숨깁니다. 추후 숏폼 끄기 같은 실험 옵션도 여기에 추가됩니다.',
  },
];

const TEXT_SHADOW_OFFSET = { x: 1, y: 1 };
const TEXT_SHADOW_LEVELS = [
  { level: 1, label: '약', blur: 1, alpha: 0.25 },
  { level: 2, label: '중', blur: 2, alpha: 0.45 },
  { level: 3, label: '강', blur: 3, alpha: 0.65 },
];
const TEXT_SHADOW_COLORS = [
  { key: 'black', label: '검정', rgb: [0, 0, 0] },
  { key: 'red', label: '빨강', rgb: [239, 68, 68] },
  { key: 'green', label: '초록', rgb: [34, 197, 94] },
  { key: 'blue', label: '파랑', rgb: [59, 130, 246] },
  { key: 'amber', label: '주황', rgb: [245, 158, 11] },
  { key: 'cyan', label: '시안', rgb: [6, 182, 212] },
];
const DEFAULT_TEXT_SHADOW_COLOR_KEY = 'black';
const DEFAULT_TEXT_SHADOW_LEVEL = 1;

function clampShadowLevel(level) {
  const n = parseInt(String(level), 10);
  if (!Number.isFinite(n)) return DEFAULT_TEXT_SHADOW_LEVEL;
  return Math.max(1, Math.min(TEXT_SHADOW_LEVELS.length, n));
}

function getShadowColorByKey(key) {
  return TEXT_SHADOW_COLORS.find((color) => color.key === key) || TEXT_SHADOW_COLORS[0];
}

function shadowColorCss(color) {
  return `rgb(${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]})`;
}

function buildTextShadowValue(level, colorKey) {
  const clampedLevel = clampShadowLevel(level);
  const color = getShadowColorByKey(colorKey);
  const meta = TEXT_SHADOW_LEVELS[clampedLevel - 1];
  const rgba = `rgba(${color.rgb[0]}, ${color.rgb[1]}, ${color.rgb[2]}, ${meta.alpha})`;
  return `${TEXT_SHADOW_OFFSET.x}px ${TEXT_SHADOW_OFFSET.y}px ${meta.blur}px ${rgba}`;
}

function parseHexColor(raw) {
  const hex = String(raw || '').replace('#', '').trim();
  if (hex.length === 3) {
    const r = parseInt(hex[0] + hex[0], 16);
    const g = parseInt(hex[1] + hex[1], 16);
    const b = parseInt(hex[2] + hex[2], 16);
    return { rgb: [r, g, b], alpha: null };
  }
  if (hex.length === 6 || hex.length === 8) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : null;
    return { rgb: [r, g, b], alpha };
  }
  return null;
}

function parseShadowColor(raw) {
  if (!raw) return null;
  const rgbaMatch = String(raw).match(/rgba?\s*\(\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)(?:[,\s]+([0-9.]+))?\s*\)/i);
  if (rgbaMatch) {
    const r = Math.max(0, Math.min(255, parseFloat(rgbaMatch[1])));
    const g = Math.max(0, Math.min(255, parseFloat(rgbaMatch[2])));
    const b = Math.max(0, Math.min(255, parseFloat(rgbaMatch[3])));
    const aRaw = rgbaMatch[4];
    const alpha = aRaw === undefined ? 1 : Math.max(0, Math.min(1, parseFloat(aRaw)));
    return { rgb: [r, g, b], alpha };
  }

  const hexMatch = String(raw).match(/#([0-9a-f]{3,8})/i);
  if (hexMatch) {
    return parseHexColor(hexMatch[1]);
  }

  return null;
}

function parseShadowBlur(raw) {
  const matches = String(raw || '').match(/-?\d+(?:\.\d+)?px/g) || [];
  if (matches.length < 3) return null;
  const blur = parseFloat(matches[2]);
  return Number.isFinite(blur) ? blur : null;
}

function getClosestShadowColor(targetRgb) {
  if (!Array.isArray(targetRgb) || targetRgb.length !== 3) return getShadowColorByKey(DEFAULT_TEXT_SHADOW_COLOR_KEY);
  let best = TEXT_SHADOW_COLORS[0];
  let bestDiff = Infinity;
  TEXT_SHADOW_COLORS.forEach((color) => {
    const dr = color.rgb[0] - targetRgb[0];
    const dg = color.rgb[1] - targetRgb[1];
    const db = color.rgb[2] - targetRgb[2];
    const diff = dr * dr + dg * dg + db * db;
    if (diff < bestDiff) {
      best = color;
      bestDiff = diff;
    }
  });
  return best;
}

function getClosestShadowLevelByAlpha(alpha) {
  const normalized = Math.max(0, Math.min(1, Number(alpha)));
  let bestLevel = DEFAULT_TEXT_SHADOW_LEVEL;
  let bestDiff = Infinity;
  TEXT_SHADOW_LEVELS.forEach((level) => {
    const diff = Math.abs(level.alpha - normalized);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLevel = level.level;
    }
  });
  return bestLevel;
}

function getClosestShadowLevelByBlur(blur) {
  let bestLevel = DEFAULT_TEXT_SHADOW_LEVEL;
  let bestDiff = Infinity;
  TEXT_SHADOW_LEVELS.forEach((level) => {
    const diff = Math.abs(level.blur - blur);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLevel = level.level;
    }
  });
  return bestLevel;
}

function getTextShadowState(rawValue) {
  const fallbackColor = getShadowColorByKey(DEFAULT_TEXT_SHADOW_COLOR_KEY);
  const fallbackLevel = DEFAULT_TEXT_SHADOW_LEVEL;
  if (!rawValue) return { color: fallbackColor, level: fallbackLevel };

  const parsedColor = parseShadowColor(rawValue);
  const blur = parseShadowBlur(rawValue);
  const color = parsedColor?.rgb ? getClosestShadowColor(parsedColor.rgb) : fallbackColor;

  let level = fallbackLevel;
  if (typeof parsedColor?.alpha === 'number') level = getClosestShadowLevelByAlpha(parsedColor.alpha);
  else if (typeof blur === 'number') level = getClosestShadowLevelByBlur(blur);

  return { color, level };
}

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
  let currentPreviewCategory = 'media';

  let selectedMediaPreviewVariant = null;
  let settingsPreviewTextPromise = null;
  let settingsPreviewTextCache = null;
  let settingsPreviewAudioEl = null;
  let settingsPreviewUpdateToken = 0;
  let audioFadeToken = 0;
  let indicatorConfig = { ...INDICATOR_CONFIG_DEFAULT };

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

  function syncIndicatorToggle(config = indicatorConfig) {
    if (!UI.settingsIndicatorToggle) return;
    UI.settingsIndicatorToggle.checked = !!config.enabled;
  }

  async function loadIndicatorConfig() {
    const items = await storageGet({ [INDICATOR_CONFIG_KEY]: INDICATOR_CONFIG_DEFAULT });
    indicatorConfig = normalizeIndicatorConfig(items[INDICATOR_CONFIG_KEY]);
    syncIndicatorToggle(indicatorConfig);
    return indicatorConfig;
  }

  async function persistIndicatorConfig(patch) {
    const next = { ...indicatorConfig, ...(patch && typeof patch === 'object' ? patch : {}) };
    indicatorConfig = normalizeIndicatorConfig(next);
    await storageSet({ [INDICATOR_CONFIG_KEY]: indicatorConfig });
    syncIndicatorToggle(indicatorConfig);
    chrome.runtime.sendMessage({ action: 'SETTINGS_UPDATED' });
    return indicatorConfig;
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
      if (currentPreviewCategory !== 'media') return;
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
    if (meta.control === 'shadow') {
      syncTextShadowCardUI(card);
      return;
    }

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
      const mutedAccent = `color-mix(in srgb, var(--level-${nonZeroStep}) 35%, var(--border-color))`;
      card.style.setProperty('--range-accent', isActive ? `var(--level-${nonZeroStep})` : mutedAccent);
      card.style.setProperty('--range-progress', `${((nonZeroStep - 1) / 2) * 100}%`);

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

  function syncTextShadowCardUI(card) {
    const toggle = card.querySelector('.toggle-active');
    const input = card.querySelector('.shadow-intensity');
    const output = card.querySelector('[data-shadow-output="true"]');
    const swatch = card.querySelector('[data-shadow-swatch="true"]');
    const trigger = card.querySelector('.shadow-color-trigger');
    const picker = card.querySelector('.shadow-color-picker');
    const isActive = !!toggle?.checked;

    if (input) input.disabled = !isActive;
    if (trigger) trigger.disabled = !isActive;
    card.classList.toggle('is-disabled', !isActive);

    const level = clampShadowLevel(input?.value ?? card?.dataset?.shadowLevel ?? DEFAULT_TEXT_SHADOW_LEVEL);
    const colorKey = card?.dataset?.shadowColor || DEFAULT_TEXT_SHADOW_COLOR_KEY;
    const color = getShadowColorByKey(colorKey);

    card.dataset.shadowLevel = String(level);
    card.dataset.shadowColor = color.key;
    const progress = TEXT_SHADOW_LEVELS.length > 1 ? ((level - 1) / (TEXT_SHADOW_LEVELS.length - 1)) * 100 : 0;
    const mutedAccent = `color-mix(in srgb, var(--accent) 35%, var(--border-color))`;
    card.style.setProperty('--range-progress', `${progress}%`);
    card.style.setProperty('--range-accent', isActive ? 'var(--accent)' : mutedAccent);
    if (swatch) swatch.style.setProperty('--shadow-color', shadowColorCss(color));

    if (!isActive) {
      if (output) output.textContent = 'OFF';
      if (picker) picker.classList.remove('is-open');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
      return;
    }

    if (output) output.textContent = TEXT_SHADOW_LEVELS[level - 1]?.label || `Lv${level}`;

    const options = card.querySelectorAll('.shadow-color-option');
    options.forEach((option) => {
      option.classList.toggle('is-selected', option.dataset.shadowColor === color.key);
    });
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
      let value;
      if (key === 'textShadow') {
        const level = clampShadowLevel(input?.value ?? card?.dataset?.shadowLevel ?? DEFAULT_TEXT_SHADOW_LEVEL);
        const colorKey = card?.dataset?.shadowColor || DEFAULT_TEXT_SHADOW_COLOR_KEY;
        value = buildTextShadowValue(level, colorKey);
      } else {
        value = input ? valueForStorageV2(key, meta, input?.value) : next[key]?.value;
      }
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

  function setPreviewCategoryFromCard(card) {
    const category = card?.dataset?.category;
    if (category) currentPreviewCategory = category;
  }

  function createSettingCard(key, meta, setting) {
    const isShadowControl = meta.control === 'shadow';
    const inputValue = isShadowControl ? null : valueForInputV2(meta, setting.value);
    const inputId = `setting-${key}`;
    const isToggleOnly = meta.control === 'toggle';
    const shadowState = isShadowControl ? getTextShadowState(setting.value) : null;
    const control = meta.control === 'text' ? 'text' : 'range';
    const isActive = !!setting.isActive;
    const isStepRange = control === 'range' && meta.storage === 'step';

    const card = document.createElement('div');
    card.className = 'setting-card';
    card.dataset.key = key;
    card.dataset.category = meta.category || '';
    if (isToggleOnly) card.classList.add('is-toggle-only');
    if (isStepRange) card.classList.add('is-stepped');
    if (isShadowControl) card.classList.add('is-stepped', 'is-shadow');
    if (shadowState) {
      card.dataset.shadowColor = shadowState.color.key;
      card.dataset.shadowLevel = String(shadowState.level);
    }
    const controlMarkup = isToggleOnly
      ? `<div class="setting-helper">${meta.helper || ''}</div>`
      : isShadowControl
        ? `
          <div class="setting-shadow-row">
            <div class="setting-shadow-slider">
              <input
                id="${inputId}"
                class="input-value input-range shadow-intensity"
                data-key="${key}"
                type="range"
                value="${shadowState ? shadowState.level : 1}"
                min="1"
                max="3"
                step="1"
                ${isActive ? '' : 'disabled'}
              >
              <output class="setting-output" data-shadow-output="true" for="${inputId}" aria-live="polite"></output>
            </div>
            <div class="shadow-color-picker">
              <button type="button" class="shadow-color-trigger" aria-expanded="false" aria-label="그림자 색상 선택" ${isActive ? '' : 'disabled'}>
                <span class="shadow-color-swatch" data-shadow-swatch="true"></span>
              </button>
              <div class="shadow-color-popover" role="menu">
                ${TEXT_SHADOW_COLORS.map(
                  (color) => `
                    <button
                      type="button"
                      class="shadow-color-option"
                      data-shadow-color="${color.key}"
                      style="--shadow-color: ${shadowColorCss(color)}"
                      aria-label="${color.label}"
                    ></button>
                  `
                ).join('')}
              </div>
            </div>
          </div>
        `
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

  function getCategoryEntries(category, showExperimental) {
    return Object.entries(SETTING_METADATA_V2)
      .filter(([, meta]) => meta.category === category)
      .filter(([, meta]) => meta?.tier !== EXPERIMENTAL_TIER || showExperimental)
      .sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
  }

  async function updateSettingsPreviewV2() {
    if (!UI.settingsPreview || !UI.previewBefore || !UI.previewAfter) return;
    const settings = materializeFilterSettings(getSettings() || {});
    const token = ++settingsPreviewUpdateToken;
    const previewCategory = currentPreviewCategory;

    clearFrames();

    if (previewCategory !== 'media') {
      fadeMediaPreviewAudioTo(0, { pauseAtEnd: true });
    }

    if (previewCategory === 'media') {
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

    if (previewCategory === 'text') {
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
    const showExperimental = isExperimentalSettingsEnabled();
    const settings = getSettings() || {};
    const sections = SETTINGS_CATEGORY_ORDER
      .map((category) => {
        const entries = getCategoryEntries(category.key, showExperimental);
        if (!entries.length) return null;

        const section = document.createElement('section');
        section.className = 'settings-category';
        section.dataset.category = category.key;
        section.innerHTML = `
          <div class="settings-category-header">
            <div class="settings-category-title">${category.label}</div>
            ${category.description ? `<p class="settings-category-desc">${category.description}</p>` : ''}
          </div>
        `;

        const body = document.createElement('div');
        body.className = 'settings-category-body';
        entries.forEach(([key, meta]) => {
          const setting = settings[key] || CONFIG_DEFAULT_FILTER_SETTINGS[key] || { isActive: false, value: '' };
          body.appendChild(createSettingCard(key, meta, setting));
        });

        section.appendChild(body);
        return section;
      })
      .filter(Boolean);

    sections.forEach((section, index) => {
      UI.settingsGrid.appendChild(section);
      if (index < sections.length - 1) {
        const divider = document.createElement('div');
        divider.className = 'settings-category-divider';
        UI.settingsGrid.appendChild(divider);
      }
    });
  }

  function setup() {
    setupMediaPreviewHoverAudio();

    if (UI.settingsIndicatorToggle) {
      UI.settingsIndicatorToggle.addEventListener('change', () => {
        const enabled = !!UI.settingsIndicatorToggle.checked;
        persistIndicatorConfig({ ...indicatorConfig, enabled }).catch(() => {});
      });
      loadIndicatorConfig().catch(() => {});
    }

    if (UI.settingsGrid) {
      UI.settingsGrid.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;

        const trigger = target.closest('.shadow-color-trigger');
        if (trigger) {
          const picker = trigger.closest('.shadow-color-picker');
          if (!picker) return;
          UI.settingsGrid.querySelectorAll('.shadow-color-picker.is-open').forEach((other) => {
            if (other !== picker) {
              other.classList.remove('is-open');
              const otherTrigger = other.querySelector('.shadow-color-trigger');
              if (otherTrigger) otherTrigger.setAttribute('aria-expanded', 'false');
            }
          });
          const isOpen = picker.classList.toggle('is-open');
          trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
          return;
        }

        const option = target.closest('.shadow-color-option');
        if (option) {
          const card = option.closest('.setting-card');
          if (!card) return;
          card.dataset.shadowColor = option.dataset.shadowColor || DEFAULT_TEXT_SHADOW_COLOR_KEY;
          setPreviewCategoryFromCard(card);

          const picker = option.closest('.shadow-color-picker');
          if (picker) {
            picker.classList.remove('is-open');
            const pickerTrigger = picker.querySelector('.shadow-color-trigger');
            if (pickerTrigger) pickerTrigger.setAttribute('aria-expanded', 'false');
          }

          syncSettingCardUIV2(card);
          collectSettingsFromGridV2();
          updateSettingsPreviewV2();
          persistCurrentSettings().catch(() => {});
        }
      });

      UI.settingsGrid.addEventListener('change', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const card = target.closest('.setting-card');
        if (!card) return;

        if (target.classList.contains('toggle-active')) {
          setPreviewCategoryFromCard(card);
          syncSettingCardUIV2(card);
          collectSettingsFromGridV2();
          updateSettingsPreviewV2();
          persistCurrentSettings().catch(() => {});
          return;
        }

        if (target.classList.contains('input-value')) {
          setPreviewCategoryFromCard(card);
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
          setPreviewCategoryFromCard(card);
          syncSettingCardUIV2(card);
          collectSettingsFromGridV2();
          updateSettingsPreviewV2();
        }
      });
    }

  }

  async function display() {
    displaySettingsV2();
    await loadIndicatorConfig();
    await updateSettingsPreviewV2();
  }

  function beforeLeave() {
    collectSettingsFromGridV2();
    persistCurrentSettings().catch(() => {});
    fadeMediaPreviewAudioTo(0, { pauseAtEnd: true });
  }

  return { setup, display, beforeLeave };
}
