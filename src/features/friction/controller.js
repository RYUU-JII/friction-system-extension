import VisualManager from './visualManager.js';
import SocialMetricsManager from './socialMetricsManager.js';
import DelayManager from './delayManager.js';
import TextManager from './textManager.js';
import TextShuffleManager from './textShuffleManager.js';
import InputDelayManager from './inputDelayManager.js';
import InteractionManager from './interactionManager.js';
import NudgeGame from './nudgeGame.js';
import AnxietySensor from './anxietySensor.js';
import VideoSkipManager from './videoSkipManager.js';

function clearAllFriction() {
  VisualManager.remove();
  SocialMetricsManager.remove();
  DelayManager.remove();
  TextManager.remove();
  TextShuffleManager.disable();
  InputDelayManager.remove();
  InteractionManager.removeClickDelay();
  InteractionManager.removeScroll();
  VideoSkipManager.remove();
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

    if (filters.videoSkipGuard?.isActive) VideoSkipManager.apply();
    else VideoSkipManager.remove();

    TextManager.update(filters);
    TextShuffleManager.update(filters.textShuffle);
    sendResponse?.({ ok: true });
    return false;
  });

  AnxietySensor.init();
}
