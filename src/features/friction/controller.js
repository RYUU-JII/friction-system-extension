import { ROOT_ATTRS } from './constants.js';
import { setRootAttribute, removeRootAttribute } from './dom.js';
import VisualManager from './visualManager.js';
import SocialMetricsManager from './socialMetricsManager.js';
import DelayManager from './delayManager.js';
import TextManager from './textManager.js';
import TextShuffleManager from './textShuffleManager.js';
import InputDelayManager from './inputDelayManager.js';
import InteractionManager from './interactionManager.js';
import NudgeGame from './nudgeGame.js';
import AnxietySensor from './anxietySensor.js';

function clearAllFriction() {
  VisualManager.remove();
  SocialMetricsManager.remove();
  DelayManager.remove();
  TextManager.remove();
  TextShuffleManager.disable();
  InputDelayManager.remove();
  InteractionManager.removeClickDelay();
  InteractionManager.removeScroll();
  removeRootAttribute(ROOT_ATTRS.HOVER_REVEAL);
  if (NudgeGame.isActive() && NudgeGame.getMode() !== 'debug') {
    NudgeGame.stop();
  }
}

export function initFrictionController() {
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request && typeof request.type === 'string') {
      try {
        if (request.type === 'NUDGE_START') {
          const cfg = request.payload?.config || {};
          NudgeGame.start({ ...cfg, __mode: request.payload?.reason === 'debug' ? 'debug' : 'auto' });
        } else if (request.type === 'NUDGE_STOP') {
          NudgeGame.stop();
        } else if (request.type === 'NUDGE_DEBUG_START') {
          const cfg = request.payload?.config || {};
          NudgeGame.start({ ...cfg, __mode: 'debug' });
        } else if (request.type === 'NUDGE_DEBUG_CONFIG') {
          NudgeGame.setConfig(request.payload?.config);
        } else if (request.type === 'NUDGE_DEBUG_SPAWN') {
          const cfg = request.payload?.config || {};
          if (!NudgeGame.isActive()) NudgeGame.start({ ...cfg, __mode: 'debug' });
          else if (request.payload?.config) NudgeGame.setConfig(request.payload?.config);
          NudgeGame.spawn();
        }
        sendResponse?.({ ok: true });
      } catch (e) {
        sendResponse?.({ ok: false, error: String(e?.message || e) });
      }
      return false;
    }

    if (typeof request?.isBlocked === 'boolean' && !request.isBlocked) {
      clearAllFriction();
      sendResponse?.({ ok: true });
      return false;
    }

    if (!request || !request.filters) return;
    const { filters } = request;

    const hoverRevealSetting = filters.hoverReveal;
    const hoverRevealEnabled = hoverRevealSetting ? !!hoverRevealSetting.isActive : true;
    if (hoverRevealEnabled) setRootAttribute(ROOT_ATTRS.HOVER_REVEAL, '1');
    else removeRootAttribute(ROOT_ATTRS.HOVER_REVEAL);

    VisualManager.update(filters);
    SocialMetricsManager.update(filters.socialEngagement, filters.socialExposure);

    if (filters.delay?.isActive) DelayManager.apply(filters.delay.value);
    else DelayManager.remove();

    if (filters.inputDelay?.isActive) InputDelayManager.apply(filters.inputDelay.value);
    else InputDelayManager.remove();

    if (filters.clickDelay?.isActive) InteractionManager.applyClickDelay(filters.clickDelay.value);
    else InteractionManager.removeClickDelay();

    if (filters.scrollFriction?.isActive) InteractionManager.applyScroll(filters.scrollFriction.value);
    else InteractionManager.removeScroll();

    TextManager.update(filters);
    TextShuffleManager.update(filters.textShuffle, { hoverRevealEnabled });
    sendResponse?.({ ok: true });
    return false;
  });

  AnxietySensor.init();
}
