import { getSiteSelectors } from '../../shared/config/sites.js';
import { ROOT_STATE_ATTRS } from './constants.js';
import { setRootAttribute } from './dom.js';
import { sendAnxietyMetric } from './telemetry.js';

const state = {
  clickDelayTime: 0,
  scrollDelayTime: 0,
  scrollAccumulator: { x: 0, y: 0 },
  scrollTimer: null,
  scrollActive: false,
  isAnyClickDelayed: false,
};

const InteractionManager = {
  handleClick(e) {
    const selectors = getSiteSelectors(window.location?.hostname);
    const interactiveTargets = selectors.interactiveTargets;
    const el = e.target.closest(interactiveTargets);

    if (!el) return;

    if (e.target.tagName === 'IMG') {
      return;
    }

    const parentAnchor = e.target.closest('a');
    if (parentAnchor && parentAnchor.querySelector('img')) {
      return;
    }

    const existingTimerId = el.dataset.frictionTimerId;

    if (existingTimerId) {
      clearTimeout(Number(existingTimerId));
      delete el.dataset.frictionTimerId;
      el.dataset.frictionClicking = '';
      el.style.opacity = '';
      el.style.pointerEvents = '';
    }

    if (state.isAnyClickDelayed && el.dataset.frictionClicking !== 'bypass') {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }

    const isNavigationTarget =
      el.tagName === 'A' ||
      el.tagName === 'BUTTON' ||
      el.tagName === 'ARTICLE' ||
      el.tagName === 'FIGURE' ||
      el.hasAttribute('href') ||
      el.hasAttribute('onclick') ||
      el.matches(selectors.interaction?.inputSubmit) ||
      el.matches(selectors.interaction?.inputImage) ||
      el.getAttribute('role') === 'link' ||
      el.getAttribute('role') === 'button' ||
      el.getAttribute('role') === 'article' ||
      el.getAttribute('role') === 'menuitem' ||
      el.getAttribute('role') === 'option' ||
      el.getAttribute('role') === 'tab' ||
      el.getAttribute('role') === 'checkbox' ||
      el.getAttribute('role') === 'radio' ||
      el.getAttribute('role') === 'switch';

    if (!isNavigationTarget) {
      return;
    }

    if (el.dataset.frictionClicking === 'bypass') {
      el.dataset.frictionClicking = '';
      state.isAnyClickDelayed = false;
      return;
    }

    if (!document.body.contains(el)) return;

    e.preventDefault();
    e.stopImmediatePropagation();

    el.dataset.frictionClicking = 'true';
    state.isAnyClickDelayed = true;

    let originalOpacity = '';
    const isArticle = el.tagName === 'ARTICLE';

    if (!isArticle) {
      originalOpacity = el.style.opacity;
      el.style.opacity = '0.5';
      el.style.pointerEvents = 'none';
    }

    const timerId = setTimeout(() => {
      if (!document.body.contains(el)) {
        return;
      }

      el.dataset.frictionClicking = '';

      if (!isArticle) {
        el.style.opacity = originalOpacity;
        el.style.pointerEvents = '';
      }

      delete el.dataset.frictionTimerId;
      el.dataset.frictionClicking = 'bypass';

      const originalHref = el.getAttribute('href');
      const isJsUrl = originalHref && originalHref.toLowerCase().startsWith('javascript:');

      if (isJsUrl) {
        el.removeAttribute('href');
      }

      el.click();

      if (isJsUrl) {
        el.setAttribute('href', originalHref);
      }
    }, state.clickDelayTime);

    el.dataset.frictionTimerId = timerId;
  },

  applyClickDelay(value) {
    if (document.documentElement.getAttribute(ROOT_STATE_ATTRS.CLICK) === 'active') return;
    state.clickDelayTime = value;
    document.body.addEventListener('click', this.handleClick, true);
    setRootAttribute(ROOT_STATE_ATTRS.CLICK, 'active');
  },

  removeClickDelay() {
    if (document.documentElement.getAttribute(ROOT_STATE_ATTRS.CLICK) === 'active') {
      document.body.removeEventListener('click', this.handleClick, true);
      setRootAttribute(ROOT_STATE_ATTRS.CLICK, 'none');
    }
  },

  handleWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    state.scrollAccumulator.x += e.deltaX;
    state.scrollAccumulator.y += e.deltaY;

    const wheelIntensity = Math.abs(e.deltaY);
    if (wheelIntensity > 200) {
      sendAnxietyMetric('scrollSpikes');
    }

    if (state.scrollTimer) clearTimeout(state.scrollTimer);

    state.scrollTimer = setTimeout(() => {
      window.scrollBy({
        left: state.scrollAccumulator.x,
        top: state.scrollAccumulator.y,
        behavior: 'instant',
      });

      state.scrollAccumulator = { x: 0, y: 0 };
      state.scrollTimer = null;
    }, state.scrollDelayTime);
  },

  applyScroll(value) {
    if (state.scrollActive) return;
    state.scrollDelayTime = value;
    this.boundHandleWheel = this.handleWheel.bind(this);

    window.addEventListener('wheel', this.boundHandleWheel, { capture: true, passive: false });
    state.scrollActive = true;
  },

  removeScroll() {
    if (!state.scrollActive) return;
    if (this.boundHandleWheel) {
      window.removeEventListener('wheel', this.boundHandleWheel, { capture: true, passive: false });
    }
    state.scrollActive = false;
  },
};

export default InteractionManager;
