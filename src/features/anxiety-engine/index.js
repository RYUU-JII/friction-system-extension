const WEIGHTS = {
  tabSwitches: 8,
  dwellTime: 12,
  backHistory: 10,
  domLoops: 15,
  scrollSpikes: 5,
  backspaces: 2,
  clicks: 1,
  dragCount: 3,
  tabBursts: 20,
  videoSkips: 6,
  mediaDensity: 4,
};

export function calculateAnxietyScore(metrics) {
  let rawScore = 0;

  for (const [key, value] of Object.entries(metrics)) {
    if (WEIGHTS[key]) {
      rawScore += value * WEIGHTS[key];
    }
  }

  const maxReference = 120;
  return Math.min(100, Math.round((rawScore / maxReference) * 100));
}

export function getInterventionLevel(score) {
  if (score >= 80) return 'CRITICAL';
  if (score >= 50) return 'WARNING';
  if (score >= 30) return 'NOTICE';
  return 'CALM';
}
