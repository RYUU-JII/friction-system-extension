export const CONFIG_DEFAULT_CLICK_DELAY_MS = 1000;
export const CONFIG_DEFAULT_SCROLL_FRICTION_MS = 50;
export const CONFIG_DEFAULT_DELAY_TIME_CSS = '0.5s';

export const CONFIG_DEFAULT_TEXT_BLUR_VALUE = '0.3px';
export const CONFIG_DEFAULT_TEXT_SHADOW_VALUE = '0 1px 0 rgba(0,0,0,0.25)';
export const CONFIG_DEFAULT_TEXT_SHUFFLE_PROBABILITY = 0.15;

export const CONFIG_DEFAULT_INPUT_DELAY_MS = 120;

export const FILTER_STEP_MAP = {
  blur: ['0px', '2px', '5px', '10px'],
  saturation: [1, 0.5, 0.2, 0],
  textOpacity: [1, 0.9, 0.7, 0.5],
  letterSpacing: ['0px', '2px', '5px', '10px'],
  clickDelay: [0, 500, 1000, 1500],
  scrollFriction: [0, 150, 300, 500],
};

const FILTER_STEP_KEYS = new Set(Object.keys(FILTER_STEP_MAP));

export function clampFilterStep(step) {
  const n = Number(step);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(3, Math.round(n)));
}

function parseNumericValue(key, raw) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const str = String(raw).trim().toLowerCase();
  if (!str) return null;
  const match = str.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  let num = parseFloat(match[0]);
  if (!Number.isFinite(num)) return null;

  if (str.endsWith('%')) num /= 100;
  if (str.endsWith('em')) num *= 16;
  if (str.endsWith('s') && !str.endsWith('ms')) num *= 1000;

  return num;
}

function coerceStepFromValue(key, rawValue) {
  const steps = FILTER_STEP_MAP[key];
  if (!steps) return null;

  if (typeof rawValue === 'number' && Number.isFinite(rawValue) && Number.isInteger(rawValue)) {
    if (rawValue >= 0 && rawValue <= 3) return rawValue;
  }

  const numeric = parseNumericValue(key, rawValue);
  if (!Number.isFinite(numeric)) return null;

  let bestIdx = null;
  let bestDiff = Infinity;
  for (let i = 0; i < steps.length; i += 1) {
    const stepNum = parseNumericValue(key, steps[i]);
    if (!Number.isFinite(stepNum)) continue;
    const diff = Math.abs(stepNum - numeric);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIdx = i;
    }
  }

  return bestIdx;
}

export function getFilterStepValue(key, step) {
  const steps = FILTER_STEP_MAP[key];
  if (!steps) return null;
  const idx = clampFilterStep(step);
  return steps[idx];
}

export function normalizeFilterSettings(partial = {}) {
  const source = partial && typeof partial === 'object' ? { ...partial } : {};
  if (source.desaturation && !source.saturation) {
    source.saturation = source.desaturation;
  }

  const merged = {};
  for (const [key, def] of Object.entries(CONFIG_DEFAULT_FILTER_SETTINGS)) {
    const current = source[key];
    const isActive = typeof current?.isActive === 'boolean' ? current.isActive : def.isActive;
    let value = current?.value !== undefined ? current.value : def.value;

    if (FILTER_STEP_KEYS.has(key)) {
      let step = coerceStepFromValue(key, value);
      if (step === null || step === undefined) {
        step = coerceStepFromValue(key, current?.step);
      }
      if (step === null || step === undefined) {
        step = coerceStepFromValue(key, def.value);
      }
      const clamped = clampFilterStep(step ?? 0);
      const nonZero = clamped <= 0 ? 1 : clamped;
      merged[key] = { isActive, value: nonZero, step: nonZero };
      continue;
    }

    merged[key] = { isActive, value };
  }

  for (const [key, value] of Object.entries(source)) {
    if (key === 'desaturation') continue;
    if (!(key in merged)) merged[key] = value;
  }

  if (source.socialMetrics?.isActive) {
    if (!source.socialEngagement) merged.socialEngagement.isActive = true;
    if (!source.socialExposure) merged.socialExposure.isActive = true;
  }

  return merged;
}

export function materializeFilterSettings(partial = {}) {
  const normalized = normalizeFilterSettings(partial);
  const materialized = {};

  for (const [key, entry] of Object.entries(normalized)) {
    if (!entry || typeof entry !== 'object') {
      materialized[key] = entry;
      continue;
    }

    if (FILTER_STEP_KEYS.has(key)) {
      const step = clampFilterStep(entry.step ?? entry.value ?? 0);
      materialized[key] = { ...entry, step, value: getFilterStepValue(key, step) };
      continue;
    }

    materialized[key] = { ...entry };
  }

  return materialized;
}

export const CONFIG_DEFAULT_FILTER_SETTINGS = {
  blur: { isActive: true, value: 1 },
  delay: { isActive: true, value: CONFIG_DEFAULT_DELAY_TIME_CSS },
  clickDelay: { isActive: true, value: 2 },
  scrollFriction: { isActive: true, value: 1 },
  saturation: { isActive: true, value: 1 },
  videoSkipGuard: { isActive: true, value: '' },
  letterSpacing: { isActive: true, value: 1 },
  textOpacity: { isActive: false, value: 1 },
  textBlur: { isActive: false, value: CONFIG_DEFAULT_TEXT_BLUR_VALUE },
  textShadow: { isActive: false, value: CONFIG_DEFAULT_TEXT_SHADOW_VALUE },
  textShuffle: { isActive: false, value: CONFIG_DEFAULT_TEXT_SHUFFLE_PROBABILITY },
  socialEngagement: { isActive: false, value: '' },
  socialExposure: { isActive: false, value: '' },
  inputDelay: { isActive: false, value: CONFIG_DEFAULT_INPUT_DELAY_MS },
};
