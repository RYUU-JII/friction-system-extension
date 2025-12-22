import { getSiteSelectors } from '../../shared/config/sites.js';
import { TARGET_ATTRS } from './constants.js';

const targetSelectors = {
  visual: `[${TARGET_ATTRS.VISUAL}="1"]`,
  visualVideo: `[${TARGET_ATTRS.VISUAL_VIDEO}="1"]`,
};

const HoverRevealManager = {
  enabled: false,
  currentScope: null,
  boundPointerOver: null,
  boundPointerOut: null,
  boundPointerCancel: null,
  boundWindowBlur: null,
  boundVisibilityChange: null,
  boundScrollOrResize: null,
  lastClientX: null,
  lastClientY: null,
  rafId: null,
  pendingClearTimer: null,
  _lastRevealSweepAt: 0,

  _closestCrossShadow(startEl, selector) {
    if (!(startEl instanceof Element)) return null;
    if (!selector) return null;

    let current = startEl;
    while (current) {
      try {
        if (current.matches(selector)) return current;
      } catch (_) {
        return null;
      }

      if (current.parentElement) {
        current = current.parentElement;
        continue;
      }

      const root = current.getRootNode?.();
      const host = root && root.host;
      if (host instanceof Element) {
        current = host;
        continue;
      }

      break;
    }

    return null;
  },

  _getBestVisualTargetAtPoint(clientX, clientY) {
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return null;
    if (!document.elementsFromPoint) return null;

    let stack = [];
    try {
      stack = document.elementsFromPoint(clientX, clientY) || [];
    } catch (_) {
      return null;
    }
    if (!Array.isArray(stack) || stack.length === 0) return null;

    const selectors = getSiteSelectors(window.location?.hostname);
    const pickFirstMatching = (selector) => {
      if (!selector) return null;
      for (const el of stack) {
        if (!(el instanceof Element)) continue;
        try {
          if (el.matches(selector)) return el;
        } catch (_) {
          // ignore invalid selector / cross-origin edge cases
        }
      }
      return null;
    };

    return (
      pickFirstMatching(targetSelectors.visualVideo) ||
      pickFirstMatching(selectors.hoverReveal?.mediaStackImage) ||
      pickFirstMatching(selectors.hoverReveal?.mediaStackBackground) ||
      pickFirstMatching(selectors.hoverReveal?.mediaStackRoleImg) ||
      pickFirstMatching(targetSelectors.visual)
    );
  },

  _getSitePreferredScope(el) {
    if (!(el instanceof Element)) return null;
    const selectors = getSiteSelectors(window.location?.hostname);
    const scopeSelector = selectors.hoverRevealScope;
    if (!scopeSelector) return null;
    return this._closestCrossShadow(el, scopeSelector);
  },

  _getRevealScope(target, clientX, clientY) {
    const selectors = getSiteSelectors(window.location?.hostname);
    const visualAtPoint = this._getBestVisualTargetAtPoint(clientX, clientY);
    if (visualAtPoint) {
      return (
        this._getSitePreferredScope(visualAtPoint) ||
        this._closestCrossShadow(visualAtPoint, selectors.hoverReveal?.twitterPhotoScope) ||
        this._closestCrossShadow(visualAtPoint, selectors.hoverReveal?.videoHoverScope) ||
        visualAtPoint
      );
    }

    if (target instanceof Element) {
      return (
        this._getSitePreferredScope(target) ||
        this._closestCrossShadow(target, selectors.hoverReveal?.twitterPhotoScope) ||
        this._closestCrossShadow(target, selectors.hoverReveal?.videoHoverScope) ||
        this._closestCrossShadow(target, selectors.hoverReveal?.mediaStackFallback)
      );
    }

    return null;
  },

  _cancelPendingClear() {
    if (!this.pendingClearTimer) return;
    try {
      clearTimeout(this.pendingClearTimer);
    } catch (_) {}
    this.pendingClearTimer = null;
  },

  _scheduleDeferredClear(delayMs = 80) {
    if (!this.enabled) return;
    if (!this.currentScope) return;

    this._cancelPendingClear();
    this.pendingClearTimer = setTimeout(() => {
      this.pendingClearTimer = null;
      if (!this.enabled) return;
      this._reconcile();
    }, Math.max(0, Number(delayMs) || 0));
  },

  _scheduleReconcile() {
    if (!this.enabled) return;
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this._reconcile();
    });
  },

  _reconcile() {
    if (!this.enabled) return;

    this._sweepRevealMarks(this.currentScope);

    if (this.currentScope && this.currentScope instanceof Element && !this.currentScope.isConnected) {
      this.clear();
    }

    const clientX = this.lastClientX;
    const clientY = this.lastClientY;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return;

    const scopeAtPoint = this._getRevealScope(null, clientX, clientY);
    if (!scopeAtPoint) {
      this.clear();
      return;
    }

    if (!this.currentScope) {
      this.currentScope = scopeAtPoint;
      try {
        scopeAtPoint.setAttribute('data-friction-reveal', '1');
      } catch (_) {}
      return;
    }

    const same =
      scopeAtPoint === this.currentScope ||
      this.currentScope.contains(scopeAtPoint) ||
      scopeAtPoint.contains(this.currentScope);

    if (same) return;

    this.clear();
    this.currentScope = scopeAtPoint;
    this._sweepRevealMarks(this.currentScope);
    try {
      scopeAtPoint.setAttribute('data-friction-reveal', '1');
    } catch (_) {}
  },

  _sweepRevealMarks(keepEl) {
    const now = Date.now();
    if (now - this._lastRevealSweepAt < 200) return;
    this._lastRevealSweepAt = now;

    let marked = [];
    try {
      marked = document.querySelectorAll('[data-friction-reveal="1"]');
    } catch (_) {
      return;
    }
    for (const el of marked) {
      if (!(el instanceof Element)) continue;
      if (keepEl && (el === keepEl || keepEl.contains(el) || el.contains(keepEl))) continue;
      try {
        el.removeAttribute('data-friction-reveal');
      } catch (_) {}
    }
  },

  update({ enabled } = {}) {
    const nextEnabled = !!enabled;
    if (nextEnabled === this.enabled) return;
    this.enabled = nextEnabled;
    if (nextEnabled) this.enable();
    else this.disable();
  },

  enable() {
    if (this.boundPointerOver || this.boundPointerOut) return;

    this._sweepRevealMarks(null);

    this.boundPointerOver = (e) => {
      if (!this.enabled) return;

      this._cancelPendingClear();

      const target = e?.target;
      if (!(target instanceof Element)) return;

      const clientX = Number.isFinite(e?.clientX) ? e.clientX : null;
      const clientY = Number.isFinite(e?.clientY) ? e.clientY : null;
      this.lastClientX = clientX;
      this.lastClientY = clientY;

      const scope = this._getRevealScope(target, clientX, clientY);
      if (!scope || scope === this.currentScope) return;

      this.clear();
      this.currentScope = scope;
      this._sweepRevealMarks(this.currentScope);
      try {
        scope.setAttribute('data-friction-reveal', '1');
      } catch (_) {}
    };

    this.boundPointerOut = (e) => {
      if (!this.enabled) return;
      if (!this.currentScope) return;

      const clientX = Number.isFinite(e?.clientX) ? e.clientX : this.lastClientX;
      const clientY = Number.isFinite(e?.clientY) ? e.clientY : this.lastClientY;
      this.lastClientX = clientX;
      this.lastClientY = clientY;

      const scopeAtPoint = this._getRevealScope(null, clientX, clientY);
      if (
        scopeAtPoint &&
        (scopeAtPoint === this.currentScope ||
          this.currentScope.contains(scopeAtPoint) ||
          scopeAtPoint.contains(this.currentScope))
      ) {
        return;
      }

      if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
        const related = e?.relatedTarget;
        if (related instanceof Node && this.currentScope.contains(related)) return;
      }

      this._scheduleDeferredClear(100);
    };

    this.boundPointerCancel = () => {
      if (!this.enabled) return;
      this.clear();
    };

    this.boundWindowBlur = () => {
      if (!this.enabled) return;
      this.clear();
    };

    this.boundVisibilityChange = () => {
      if (!this.enabled) return;
      if (document.visibilityState !== 'visible') this.clear();
      else this._scheduleReconcile();
    };

    this.boundScrollOrResize = () => {
      if (!this.enabled) return;
      this._scheduleReconcile();
    };

    document.addEventListener('pointerover', this.boundPointerOver, true);
    document.addEventListener('pointerout', this.boundPointerOut, true);
    document.addEventListener('pointercancel', this.boundPointerCancel, true);
    window.addEventListener('blur', this.boundWindowBlur, true);
    document.addEventListener('visibilitychange', this.boundVisibilityChange, true);
    window.addEventListener('scroll', this.boundScrollOrResize, true);
    window.addEventListener('resize', this.boundScrollOrResize, true);
  },

  disable() {
    if (this.boundPointerOver) document.removeEventListener('pointerover', this.boundPointerOver, true);
    if (this.boundPointerOut) document.removeEventListener('pointerout', this.boundPointerOut, true);
    if (this.boundPointerCancel) document.removeEventListener('pointercancel', this.boundPointerCancel, true);
    if (this.boundWindowBlur) window.removeEventListener('blur', this.boundWindowBlur, true);
    if (this.boundVisibilityChange) document.removeEventListener('visibilitychange', this.boundVisibilityChange, true);
    if (this.boundScrollOrResize) {
      window.removeEventListener('scroll', this.boundScrollOrResize, true);
      window.removeEventListener('resize', this.boundScrollOrResize, true);
    }
    this.boundPointerOver = null;
    this.boundPointerOut = null;
    this.boundPointerCancel = null;
    this.boundWindowBlur = null;
    this.boundVisibilityChange = null;
    this.boundScrollOrResize = null;
    if (this.rafId) {
      try {
        cancelAnimationFrame(this.rafId);
      } catch (_) {}
      this.rafId = null;
    }
    this._cancelPendingClear();
    this.clear();
  },

  clear() {
    if (!this.currentScope) return;
    try {
      this.currentScope.removeAttribute('data-friction-reveal');
    } catch (_) {}
    this.currentScope = null;
    this._sweepRevealMarks(null);
  },
};

export default HoverRevealManager;
