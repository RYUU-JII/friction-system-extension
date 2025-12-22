import DataManager from '../../shared/storage/DataManager.js';
import { CONFIG_DEFAULT_FILTER_SETTINGS } from '../../shared/config/index.js';
import { isFrictionTime, getHostname } from '../../shared/utils/index.js';
import { ROOT_ATTRS } from './constants.js';
import { setRootAttribute, removeRootAttribute } from './dom.js';
import VisualManager from './visualManager.js';
import SocialMetricsManager from './socialMetricsManager.js';
import DelayManager from './delayManager.js';
import TextManager from './textManager.js';
import TextShuffleManager from './textShuffleManager.js';
import InputDelayManager from './inputDelayManager.js';
import InteractionManager from './interactionManager.js';

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

  const filters = items.filterSettings || {};
  const hoverRevealSetting = filters.hoverReveal;
  const hoverRevealEnabled = hoverRevealSetting ? !!hoverRevealSetting.isActive : true;
  if (hoverRevealEnabled) setRootAttribute(ROOT_ATTRS.HOVER_REVEAL, '1');
  else removeRootAttribute(ROOT_ATTRS.HOVER_REVEAL);

  TextManager.update(filters);
  TextShuffleManager.update(filters.textShuffle, { hoverRevealEnabled });
  if (filters.delay?.isActive) DelayManager.apply(filters.delay.value);
  if (filters.inputDelay?.isActive) InputDelayManager.apply(filters.inputDelay.value);
  if (filters.clickDelay?.isActive) InteractionManager.applyClickDelay(filters.clickDelay.value);
  if (filters.scrollFriction?.isActive) InteractionManager.applyScroll(filters.scrollFriction.value);
  VisualManager.update(filters);
  SocialMetricsManager.update(filters.socialEngagement, filters.socialExposure);
}
