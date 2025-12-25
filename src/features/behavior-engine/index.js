export const BEHAVIOR_METRIC_KEYS = [
  'clicks',
  'backspaces',
  'dragCount',
  'backHistory',
  'tabSwitches',
  'videoSkips',
  'pageLoads',
  'scrollEvents',
  'scrollDeltaX',
  'scrollDeltaY',
  'scrollSpikes',
  'shortDwells',
];

export function createBehaviorMetrics() {
  return BEHAVIOR_METRIC_KEYS.reduce((acc, key) => {
    acc[key] = 0;
    return acc;
  }, {});
}

export function normalizeBehaviorMetrics(raw = {}) {
  const base = createBehaviorMetrics();
  for (const key of BEHAVIOR_METRIC_KEYS) {
    const value = Number(raw[key]);
    if (Number.isFinite(value)) base[key] = value;
  }
  return base;
}
