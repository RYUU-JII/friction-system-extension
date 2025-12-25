import DataManager from '../../shared/storage/DataManager.js';
import { CONFIG_DEFAULT_FILTER_SETTINGS, materializeFilterSettings } from '../../shared/config/index.js';
import { isFrictionTime, getHostname } from '../../shared/utils/index.js';
import VisualManager from './visualManager.js';
import SocialMetricsManager from './socialMetricsManager.js';
import DelayManager from './delayManager.js';
import TextManager from './textManager.js';
import TextShuffleManager from './textShuffleManager.js';
import InputDelayManager from './inputDelayManager.js';
import InteractionManager from './interactionManager.js';
import VideoSkipManager from './videoSkipManager.js';

export async function earlyApplyFriction() {
  const dataManager = DataManager.getInstance();
  const items = await dataManager.getLocal({
    blockedUrls: [],
    schedule: { scheduleActive: false, startMin: 0, endMin: 1440 },
    filterSettings: CONFIG_DEFAULT_FILTER_SETTINGS,
  });

  const url = window.location.href;
  const hostname = getHostname(url);
  const isBlocked = hostname && Array.isArray(items.blockedUrls) && items.blockedUrls.includes(hostname);
  const isTimeActive = isFrictionTime(items.schedule);

  if (!isBlocked || !isTimeActive) return;

  const filters = materializeFilterSettings(items.filterSettings || {});
  TextManager.update(filters);
  TextShuffleManager.update(filters.textShuffle);
  if (filters.delay?.isActive) DelayManager.apply(filters.delay.value);
  if (filters.inputDelay?.isActive) InputDelayManager.apply(filters.inputDelay.value);
  if (filters.clickDelay?.isActive) InteractionManager.applyClickDelay(filters.clickDelay.value);
  if (filters.scrollFriction?.isActive) InteractionManager.applyScroll(filters.scrollFriction.value);
  if (filters.videoSkipGuard?.isActive) VideoSkipManager.apply();
  VisualManager.update(filters);
  SocialMetricsManager.update(filters.socialEngagement, filters.socialExposure);
}
