import observerHub from '../../shared/dom/ObserverHub.js';
import { getSiteSelectors } from '../../shared/config/sites.js';
import { ROOT_ATTRS, SOCIAL_METRIC_ATTRS, INSTAGRAM_SOCIAL_LABELS } from './constants.js';
import { setRootAttribute, removeRootAttribute } from './dom.js';

function getSocialMetricSelectorsForHost() {
  const selectors = getSiteSelectors(window.location?.hostname);
  return selectors.socialMetrics || { engagement: [], exposure: [] };
}

const SocialMetricsManager = {
  observerUnsub: null,
  _scanTimer: null,
  _activeEngagement: false,
  _activeExposure: false,
  _getHost() {
    return String(location.hostname || '').replace(/^www\./, '');
  },
  _isInstagramHost() {
    const host = this._getHost();
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  },
  _isInstagramPostCount(el) {
    if (!(el instanceof Element)) return false;
    let current = el;
    for (let i = 0; current && i < 4; i += 1) {
      const text = (current.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
      if (text.includes('게시물') || text.includes('posts')) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  },
  _isInstagramGridOverlayMetric(el) {
    if (!(el instanceof Element)) return false;
    const selectors = getSiteSelectors(window.location?.hostname);
    const insta = selectors.instagram || {};
    const link = el.closest(insta.postLink);
    if (!link) return false;
    if (!link.querySelector || !link.querySelector(insta.gridMedia)) return false;
    const hasOverlayIcon = link.querySelector(insta.gridOverlayIcons);
    if (!hasOverlayIcon) return false;
    return true;
  },
  _getInstagramContextHints(el) {
    const parts = [];
    const selectors = getSiteSelectors(window.location?.hostname);
    const insta = selectors.instagram || {};

    const pushAttr = (node, attr) => {
      if (!node || !node.getAttribute) return;
      const value = node.getAttribute(attr);
      if (value) parts.push(value);
    };

    pushAttr(el, 'aria-label');
    pushAttr(el, 'title');

    const interactive = el && el.closest ? el.closest(insta.buttonOrLink) : null;
    if (interactive) {
      pushAttr(interactive, 'aria-label');
      pushAttr(interactive, 'title');
      const icon = interactive.querySelector && interactive.querySelector(insta.deepLabel);
      if (icon) pushAttr(icon, 'aria-label');
    }

    const parent = el && el.parentElement ? el.parentElement : null;
    if (parent) {
      pushAttr(parent, 'aria-label');
      pushAttr(parent, 'title');
    }

    return parts.join(' ').toLowerCase();
  },
  _getInstagramButtonLabel(el) {
    const selectors = getSiteSelectors(window.location?.hostname);
    const insta = selectors.instagram || {};

    const button = el && el.closest ? el.closest(insta.buttonOrLink) : null;
    if (!button) return '';

    const isRelevantLabel = (label) => {
      return /(좋아요|댓글|comment|reply|like)/i.test(label);
    };

    const readLabel = (node) => {
      if (!node || !node.getAttribute) return '';
      const aria = node.getAttribute('aria-label');
      if (aria) return String(aria).toLowerCase();
      const title = node.getAttribute('title');
      if (title) return String(title).toLowerCase();
      const icon = node.querySelector ? node.querySelector(insta.deepLabel) : null;
      if (icon) {
        const iconLabel = icon.getAttribute('aria-label');
        if (iconLabel) return String(iconLabel).toLowerCase();
      }
      return '';
    };

    const readLabelDeep = (node) => {
      const direct = readLabel(node);
      if (direct) return direct;
      if (!node || !node.querySelector) return '';
      const nested = node.querySelector(insta.deepLabelScan);
      if (!nested) return '';
      return readLabel(nested);
    };

    const scanSiblingChain = (node) => {
      const directions = ['previousElementSibling', 'nextElementSibling'];
      let fallback = '';
      for (const direction of directions) {
        let sibling = node ? node[direction] : null;
        let steps = 0;
        while (sibling && steps < 6) {
          const label = readLabelDeep(sibling);
          if (label) {
            if (isRelevantLabel(label)) return label;
            if (!fallback) fallback = label;
          }
          sibling = sibling[direction];
          steps += 1;
        }
      }
      return fallback;
    };

    const direct = readLabelDeep(button);
    if (direct && isRelevantLabel(direct)) return direct;
    let fallback = direct;

    const parent = button.parentElement;
    if (parent) {
      const parentLabel = scanSiblingChain(button);
      if (parentLabel && isRelevantLabel(parentLabel)) return parentLabel;
      if (!fallback) fallback = parentLabel;
    }

    let current = parent;
    for (let depth = 0; current && depth < 4; depth += 1) {
      const label = scanSiblingChain(current);
      if (label && isRelevantLabel(label)) return label;
      if (!fallback) fallback = label;
      current = current.parentElement;
    }

    return fallback || '';
  },
  _getInstagramMetricInfo(el) {
    if (!(el instanceof Element)) return null;

    if (this._isInstagramGridOverlayMetric(el)) return null;
    if (this._isInstagramPostCount(el)) return null;

    const originalAttr = SOCIAL_METRIC_ATTRS.ORIGINAL_TEXT;
    const rawText = (el.getAttribute(originalAttr) || el.textContent || '').trim();
    if (!rawText) return null;

    const selectors = getSiteSelectors(window.location?.hostname);
    const insta = selectors.instagram || {};

    if (el.tagName === 'TIME' || el.closest(insta.time)) {
      return { type: 'exposure', label: INSTAGRAM_SOCIAL_LABELS.UPLOAD };
    }

    const lowerText = rawText.toLowerCase();
    if (/좋아요|like/.test(lowerText)) {
      return { type: 'engagement', label: INSTAGRAM_SOCIAL_LABELS.LIKE };
    }
    if (/댓글|comment|reply/.test(lowerText)) {
      return { type: 'engagement', label: INSTAGRAM_SOCIAL_LABELS.COMMENT };
    }
    if (/팔로워|followers?/.test(lowerText)) {
      return { type: 'engagement', label: INSTAGRAM_SOCIAL_LABELS.FOLLOWER };
    }
    if (/팔로잉|following/.test(lowerText)) {
      return { type: 'engagement', label: INSTAGRAM_SOCIAL_LABELS.FOLLOWING };
    }
    if (/조회|views?/.test(lowerText)) {
      return { type: 'exposure', label: INSTAGRAM_SOCIAL_LABELS.VIEWS };
    }

    const contextHints = this._getInstagramContextHints(el);
    if (/좋아요|like/.test(contextHints)) {
      return { type: 'engagement', label: INSTAGRAM_SOCIAL_LABELS.LIKE };
    }
    if (/댓글|comment|reply/.test(contextHints)) {
      return { type: 'engagement', label: INSTAGRAM_SOCIAL_LABELS.COMMENT };
    }
    if (/팔로워|followers?/.test(contextHints)) {
      return { type: 'engagement', label: INSTAGRAM_SOCIAL_LABELS.FOLLOWER };
    }
    if (/팔로잉|following/.test(contextHints)) {
      return { type: 'engagement', label: INSTAGRAM_SOCIAL_LABELS.FOLLOWING };
    }
    if (/조회|views?/.test(contextHints)) {
      return { type: 'exposure', label: INSTAGRAM_SOCIAL_LABELS.VIEWS };
    }

    const buttonLabel = this._getInstagramButtonLabel(el);
    if (/좋아요|like/.test(buttonLabel)) {
      return { type: 'engagement', label: INSTAGRAM_SOCIAL_LABELS.LIKE };
    }
    if (/댓글|comment|reply/.test(buttonLabel)) {
      return { type: 'engagement', label: INSTAGRAM_SOCIAL_LABELS.COMMENT };
    }

    return null;
  },
  _shouldSkipInstagramActionButton(el) {
    if (!(el instanceof Element)) return false;
    const selectors = getSiteSelectors(window.location?.hostname);
    const insta = selectors.instagram || {};
    const button = el.closest ? el.closest(insta.buttonOrLink) : null;
    if (!button) return false;

    const text = (el.textContent || '').trim();
    if (/\d/.test(text)) return false;

    const label =
      (button.getAttribute && (button.getAttribute('aria-label') || button.getAttribute('title'))) || '';
    if (String(label).trim()) return true;

    const icon =
      button.querySelector &&
      button.querySelector('svg, [role="img"], img, [aria-label], [title]');
    if (icon) return true;

    return false;
  },
  _hasInstagramIcon(el) {
    if (!(el instanceof Element)) return false;
    return !!el.querySelector('svg, img, [role="img"]');
  },
  _applyInstagramReplacement(el, label, attr) {
    if (!(el instanceof Element)) return;
    if (this._hasInstagramIcon(el)) return;
    const originalAttr = SOCIAL_METRIC_ATTRS.ORIGINAL_TEXT;
    if (!el.hasAttribute(originalAttr)) {
      el.setAttribute(originalAttr, el.textContent || '');
    }
    el.textContent = label;
    el.setAttribute(attr, '1');
  },
  _restoreInstagramText(el) {
    if (!(el instanceof Element)) return;
    const originalAttr = SOCIAL_METRIC_ATTRS.ORIGINAL_TEXT;
    if (!el.hasAttribute(originalAttr)) return;
    const original = el.getAttribute(originalAttr);
    if (original === null) return;
    el.textContent = original;
    el.removeAttribute(originalAttr);
  },
  _getTextPatterns(type) {
    const host = this._getHost();
    const isEngagement = type === 'engagement';

    const numericCounter = /^\s*[\d,.]+(?:\.\d+)?\s*(천|만|억|K|M|B)?\s*$/i;

    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      if (isEngagement) {
        return [numericCounter];
      }
      return [
        /조회수|views?/i,
        /\d+\s*(초|분|시간|일|주|개월|년)\s*전/i,
        /^\s*[\d,.]+(?:\.\d+)?\s*(천|만|억|K|M|B)?\s*회?\s*$/i,
      ];
    }

    if (host === 'x.com' || host.endsWith('.x.com') || host === 'twitter.com' || host.endsWith('.twitter.com')) {
      return [numericCounter];
    }

    if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
      if (isEngagement) {
        return [/좋아요|like|likes|followers?|following/i, numericCounter];
      }
      return [
        /조회|views?/i,
        /\d+\s*(초|분|시간|일|주|개월|년)\s*전/i,
        /^\s*\d+\s*일\s*$/i,
        /^\s*[\d,.]+(?:\.\d+)?\s*(천|만|억|K|M|B)?\s*회?\s*$/i,
      ];
    }

    return [];
  },

  _scanAndMark(type) {
    const selectors = getSocialMetricSelectorsForHost();
    const isInstagram = this._isInstagramHost();
    const list = isInstagram
      ? Array.from(new Set([...(selectors.engagement || []), ...(selectors.exposure || [])]))
      : type === 'engagement'
        ? selectors.engagement
        : selectors.exposure;
    if (!Array.isArray(list) || list.length === 0) return;
    const patterns = this._getTextPatterns(type);
    if (!patterns.length) return;

    const attr = type === 'engagement' ? SOCIAL_METRIC_ATTRS.ENGAGEMENT : SOCIAL_METRIC_ATTRS.EXPOSURE;
    const candidates = document.querySelectorAll(list.join(','));
    for (const el of candidates) {
      if (!(el instanceof Element)) continue;
      if (isInstagram && this._shouldSkipInstagramActionButton(el)) {
        if (el.hasAttribute(attr)) {
          el.removeAttribute(attr);
          this._restoreInstagramText(el);
        }
        continue;
      }
      if (isInstagram && this._hasInstagramIcon(el)) {
        if (el.hasAttribute(attr)) {
          el.removeAttribute(attr);
          this._restoreInstagramText(el);
        }
        continue;
      }
      const textSource =
        isInstagram && el.hasAttribute(SOCIAL_METRIC_ATTRS.ORIGINAL_TEXT)
          ? el.getAttribute(SOCIAL_METRIC_ATTRS.ORIGINAL_TEXT)
          : el.textContent;
      const text = (textSource || '').trim();
      if (!text) {
        if (el.hasAttribute(attr)) {
          el.removeAttribute(attr);
          if (isInstagram) this._restoreInstagramText(el);
        }
        continue;
      }
      if (!patterns.some((re) => re.test(text))) {
        if (el.hasAttribute(attr)) {
          el.removeAttribute(attr);
          if (isInstagram) this._restoreInstagramText(el);
        }
        continue;
      }
      if (isInstagram) {
        const info = this._getInstagramMetricInfo(el);
        if (!info || info.type !== type) {
          if (el.hasAttribute(attr)) {
            el.removeAttribute(attr);
            this._restoreInstagramText(el);
          }
          continue;
        }
        this._applyInstagramReplacement(el, info.label, attr);
        continue;
      }
      el.setAttribute(attr, '1');
    }
  },

  _scheduleScan() {
    if (this._scanTimer) return;
    this._scanTimer = setTimeout(() => {
      this._scanTimer = null;
      if (this._activeEngagement) this._scanAndMark('engagement');
      if (this._activeExposure) this._scanAndMark('exposure');
    }, 120);
  },

  _clearMarks(type) {
    const attr = type === 'engagement' ? SOCIAL_METRIC_ATTRS.ENGAGEMENT : SOCIAL_METRIC_ATTRS.EXPOSURE;
    const isInstagram = this._isInstagramHost();
    document.querySelectorAll(`[${attr}]`).forEach((el) => {
      try {
        el.removeAttribute(attr);
      } catch (_) {}
      if (isInstagram) this._restoreInstagramText(el);
    });
  },

  update(engagementSetting, exposureSetting) {
    const engagementActive = !!engagementSetting?.isActive;
    const exposureActive = !!exposureSetting?.isActive;
    if (!engagementActive && !exposureActive) {
      this.remove();
      return;
    }

    const selectors = getSocialMetricSelectorsForHost();
    const hasSelectors =
      (Array.isArray(selectors.engagement) && selectors.engagement.length > 0) ||
      (Array.isArray(selectors.exposure) && selectors.exposure.length > 0);
    if (!hasSelectors) {
      this.remove();
      return;
    }

    this._activeEngagement = engagementActive;
    this._activeExposure = exposureActive;

    setRootAttribute(ROOT_ATTRS.SOCIAL_METRICS, '1');

    if (!engagementActive) this._clearMarks('engagement');
    if (!exposureActive) this._clearMarks('exposure');
    if (engagementActive) this._scanAndMark('engagement');
    if (exposureActive) this._scanAndMark('exposure');
    if (!this.observerUnsub) {
      this.observerUnsub = observerHub.subscribe(
        () => this._scheduleScan(),
        { childList: true, subtree: true, characterData: true }
      );
    }
  },

  remove() {
    removeRootAttribute(ROOT_ATTRS.SOCIAL_METRICS);
    if (this.observerUnsub) {
      this.observerUnsub();
      this.observerUnsub = null;
    }
    if (this._scanTimer) {
      try {
        clearTimeout(this._scanTimer);
      } catch (_) {}
      this._scanTimer = null;
    }
    this._activeEngagement = false;
    this._activeExposure = false;
    this._clearMarks('engagement');
    this._clearMarks('exposure');
    if (this._isInstagramHost()) {
      document.querySelectorAll(`[${SOCIAL_METRIC_ATTRS.ORIGINAL_TEXT}]`).forEach((el) => {
        this._restoreInstagramText(el);
      });
    }
  },
};

export default SocialMetricsManager;
