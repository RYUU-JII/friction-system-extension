import { getSiteSelectors } from '../../shared/config/sites.js';
import { ROOT_ATTRS, TARGET_ATTRS } from './constants.js';
import { setRootAttribute, removeRootAttribute, setRootVar } from './dom.js';
import { markExisting, subscribeToTargetChanges } from './targets.js';

const TextManager = {
  _layoutObserverUnsub: null,
  _visualObserverUnsub: null,

  update(filters) {
    const spacing = filters.letterSpacing;
    const textBlur = filters.textBlur;
    const textShadow = filters.textShadow;
    const textOpacity = filters.textOpacity;

    const spacingActive = !!(spacing && spacing.isActive);
    const blurActive = !!(textBlur && textBlur.isActive);
    const shadowActive = !!(textShadow && textShadow.isActive);
    const opacityActive = !!(textOpacity && textOpacity.isActive);

    const isActive = spacingActive || blurActive || shadowActive || opacityActive;
    if (!isActive) {
      this.remove();
      return;
    }

    if (spacingActive) {
      setRootVar('--f-letter-spacing', String(spacing.value));
      setRootAttribute(ROOT_ATTRS.LETTER_SPACING, '1');
    } else {
      removeRootAttribute(ROOT_ATTRS.LETTER_SPACING);
    }

    if (blurActive) {
      setRootVar('--f-text-blur', String(textBlur.value));
      setRootAttribute(ROOT_ATTRS.TEXT_BLUR, '1');
    } else {
      removeRootAttribute(ROOT_ATTRS.TEXT_BLUR);
    }

    if (shadowActive) {
      setRootVar('--f-text-shadow', String(textShadow.value));
      setRootAttribute(ROOT_ATTRS.TEXT_SHADOW, '1');
    } else {
      removeRootAttribute(ROOT_ATTRS.TEXT_SHADOW);
    }

    if (opacityActive) {
      const rawOpacity = parseFloat(String(textOpacity.value));
      const opacityValue = Number.isFinite(rawOpacity) ? Math.max(0, Math.min(1, rawOpacity)) : 1;
      setRootVar('--f-text-opacity', String(opacityValue));
      setRootAttribute(ROOT_ATTRS.TEXT_OPACITY, '1');
    } else {
      removeRootAttribute(ROOT_ATTRS.TEXT_OPACITY);
    }

    if (blurActive || shadowActive || opacityActive) setRootAttribute(ROOT_ATTRS.TEXT_ACTIVE, '1');
    else removeRootAttribute(ROOT_ATTRS.TEXT_ACTIVE);

    const selectors = getSiteSelectors(window.location?.hostname);
    markExisting(selectors.textLayoutTargets, TARGET_ATTRS.TEXT_LAYOUT, selectors.overlayExempt);
    markExisting(selectors.textVisualTargets, TARGET_ATTRS.TEXT_VISUAL, selectors.overlayExempt);

    if (!this._layoutObserverUnsub) {
      this._layoutObserverUnsub = subscribeToTargetChanges({
        selector: selectors.textLayoutTargets,
        attr: TARGET_ATTRS.TEXT_LAYOUT,
        overlayExemptSelector: selectors.overlayExempt,
      });
    }
    if (!this._visualObserverUnsub) {
      this._visualObserverUnsub = subscribeToTargetChanges({
        selector: selectors.textVisualTargets,
        attr: TARGET_ATTRS.TEXT_VISUAL,
        overlayExemptSelector: selectors.overlayExempt,
      });
    }
  },

  remove() {
    removeRootAttribute(ROOT_ATTRS.LETTER_SPACING);
    removeRootAttribute(ROOT_ATTRS.TEXT_BLUR);
    removeRootAttribute(ROOT_ATTRS.TEXT_SHADOW);
    removeRootAttribute(ROOT_ATTRS.TEXT_OPACITY);
    removeRootAttribute(ROOT_ATTRS.TEXT_ACTIVE);
    if (this._layoutObserverUnsub) {
      this._layoutObserverUnsub();
      this._layoutObserverUnsub = null;
    }
    if (this._visualObserverUnsub) {
      this._visualObserverUnsub();
      this._visualObserverUnsub = null;
    }
  },
};

export default TextManager;
