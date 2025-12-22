import { getSiteSelectors } from '../../shared/config/sites.js';
import { ROOT_ATTRS, TARGET_ATTRS } from './constants.js';
import { setRootAttribute, removeRootAttribute, setRootVar } from './dom.js';
import { markExisting, subscribeToTargetChanges } from './targets.js';

const DelayManager = {
  _observerUnsub: null,

  apply(value) {
    const delayValue = String(value || '0s');
    setRootVar('--f-delay', delayValue);
    setRootAttribute(ROOT_ATTRS.DELAY, '1');

    const selectors = getSiteSelectors(window.location?.hostname);
    markExisting(selectors.interactiveTargets, TARGET_ATTRS.INTERACTIVE, selectors.overlayExempt);
    if (!this._observerUnsub) {
      this._observerUnsub = subscribeToTargetChanges({
        selector: selectors.interactiveTargets,
        attr: TARGET_ATTRS.INTERACTIVE,
        overlayExemptSelector: selectors.overlayExempt,
      });
    }
  },

  remove() {
    removeRootAttribute(ROOT_ATTRS.DELAY);
    if (this._observerUnsub) {
      this._observerUnsub();
      this._observerUnsub = null;
    }
  },
};

export default DelayManager;
