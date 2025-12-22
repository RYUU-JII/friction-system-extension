import observerHub from '../../shared/dom/ObserverHub.js';
import { getSiteSelectors } from '../../shared/config/sites.js';
import { ROOT_ATTRS, TARGET_ATTRS } from './constants.js';
import { setRootAttribute, removeRootAttribute, setRootVar } from './dom.js';
import { markExisting, subscribeToTargetChanges } from './targets.js';
import HoverRevealManager from './hoverRevealManager.js';

const VisualManager = {
  _videoHoverScopes: new Set(),
  _trackVideoHoverScopes: false,
  _videoObserverUnsub: null,
  _targetObserverUnsub: null,
  _videoTargetObserverUnsub: null,
  _initialScanDone: false,
  _videoTrackingInitialized: false,

  _clearVideoContainers() {
    for (const el of this._videoHoverScopes) {
      try {
        el.removeAttribute('data-friction-video-hover-scope');
      } catch (_) {}
    }
    this._videoHoverScopes.clear();
    if (this._videoObserverUnsub) {
      this._videoObserverUnsub();
      this._videoObserverUnsub = null;
    }
    this._trackVideoHoverScopes = false;
    this._videoTrackingInitialized = false;
  },

  _markVideoHoverScope(videoEl) {
    if (!videoEl || !(videoEl instanceof Element)) return;

    const mark = (el) => {
      if (!el || el === document.documentElement || el === document.body) return false;
      try {
        el.setAttribute('data-friction-video-hover-scope', '1');
      } catch (_) {
        return false;
      }
      this._videoHoverScopes.add(el);
      return true;
    };

    let current = videoEl.parentElement;
    let steps = 0;
    while (current && steps < 3 && current !== document.documentElement && current !== document.body) {
      mark(current);
      steps += 1;
      current = current.parentElement;
    }
  },

  _markVideoTracking(videoEl) {
    if (this._trackVideoHoverScopes) this._markVideoHoverScope(videoEl);
  },

  _ensureVideoContainerTracking({ trackHoverScopes } = {}) {
    const nextTrackHoverScopes = !!trackHoverScopes;
    if (!nextTrackHoverScopes && this._videoHoverScopes.size > 0) {
      for (const el of this._videoHoverScopes) {
        try {
          el.removeAttribute('data-friction-video-hover-scope');
        } catch (_) {}
      }
      this._videoHoverScopes.clear();
    }
    this._trackVideoHoverScopes = nextTrackHoverScopes;

    if (!this._trackVideoHoverScopes) {
      this._clearVideoContainers();
      return;
    }

    const selectors = getSiteSelectors(window.location?.hostname);
    if (!this._videoTrackingInitialized) {
      this._videoTrackingInitialized = true;
      markExisting(selectors.visualVideoTargets, TARGET_ATTRS.VISUAL_VIDEO, selectors.overlayExempt);
      document.querySelectorAll(selectors.visualVideoTargets).forEach((v) => this._markVideoTracking(v));
    }

    if (this._videoObserverUnsub) return;
    this._videoObserverUnsub = observerHub.subscribe(
      ({ addedNodes }) => {
        for (const node of addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.matches(selectors.visualVideoTargets)) this._markVideoTracking(node);
          if (!node.querySelectorAll) continue;
          node.querySelectorAll(selectors.visualVideoTargets).forEach((v) => this._markVideoTracking(v));
        }
      },
      { childList: true, subtree: true }
    );
  },

  _ensureTargetObservers(selectors) {
    if (!this._targetObserverUnsub) {
      this._targetObserverUnsub = subscribeToTargetChanges({
        selector: selectors.visualTargets,
        attr: TARGET_ATTRS.VISUAL,
        overlayExemptSelector: selectors.overlayExempt,
      });
    }
    if (!this._videoTargetObserverUnsub) {
      this._videoTargetObserverUnsub = subscribeToTargetChanges({
        selector: selectors.visualVideoTargets,
        attr: TARGET_ATTRS.VISUAL_VIDEO,
        overlayExemptSelector: selectors.overlayExempt,
      });
    }
  },

  update(filters) {
    const blur = filters.blur;
    const desat = filters.desaturation;
    const hoverRevealSetting = filters.hoverReveal;
    const hoverRevealEnabled = hoverRevealSetting ? !!hoverRevealSetting.isActive : true;

    const blurActive = !!(blur && blur.isActive);
    const desatActive = !!(desat && desat.isActive);
    const isActive = blurActive || desatActive;

    if (!isActive) {
      this.remove();
      return;
    }

    const blurValue = blurActive ? String(blur.value) : '0px';
    const desatValue = desatActive ? String(desat.value) : '0%';

    setRootVar('--f-blur', blurValue);
    setRootVar('--f-desat', desatValue);
    setRootAttribute(ROOT_ATTRS.VISUAL, '1');

    const selectors = getSiteSelectors(window.location?.hostname);
    if (!this._initialScanDone) {
      this._initialScanDone = true;
      markExisting(selectors.visualTargets, TARGET_ATTRS.VISUAL, selectors.overlayExempt);
      markExisting(selectors.visualVideoTargets, TARGET_ATTRS.VISUAL_VIDEO, selectors.overlayExempt);
    }
    this._ensureTargetObservers(selectors);

    const shouldTrackVideoHoverScopes = hoverRevealEnabled && (blurActive || desatActive);
    if (shouldTrackVideoHoverScopes) this._ensureVideoContainerTracking({ trackHoverScopes: true });
    else this._clearVideoContainers();

    HoverRevealManager.update({ enabled: hoverRevealEnabled && (blurActive || desatActive) });
  },

  remove() {
    removeRootAttribute(ROOT_ATTRS.VISUAL);
    this._clearVideoContainers();
    HoverRevealManager.update({ enabled: false });
    this._initialScanDone = false;
    if (this._targetObserverUnsub) {
      this._targetObserverUnsub();
      this._targetObserverUnsub = null;
    }
    if (this._videoTargetObserverUnsub) {
      this._videoTargetObserverUnsub();
      this._videoTargetObserverUnsub = null;
    }
  },
};

export default VisualManager;
