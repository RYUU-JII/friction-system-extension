import observerHub from '../../shared/dom/ObserverHub.js';
import { getSiteSelectors } from '../../shared/config/sites.js';
import { ROOT_ATTRS, TARGET_ATTRS } from './constants.js';
import { setRootAttribute, removeRootAttribute } from './dom.js';
import { markExisting, subscribeToTargetChanges } from './targets.js';

const TextShuffleManager = {
  enabled: false,
  strength: 0,
  touchedElements: new Set(),
  touchedNodes: new Set(),
  originalTextByNode: new WeakMap(),
  shuffledTextByNode: new WeakMap(),
  observerUnsub: null,
  targetObserverUnsub: null,
  debounceTimer: null,
  pendingSubtrees: new Set(),
  pendingTextNodes: new Set(),
  initialPassDone: false,

  update(setting) {
    const enabled = !!setting?.isActive;
    const strength = typeof setting?.value === 'number' ? setting.value : Number(setting?.value);
    const normalizedStrength = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;

    if (!enabled || normalizedStrength <= 0) {
      this.disable();
      return;
    }

    this.enabled = true;
    this.strength = normalizedStrength;
    this.ensureTargetMarkers();
    this.maybeShieldInitialPaint();
    this.applyAll();
    this.ensureObserver();
    this.initialPassDone = true;
  },

  disable() {
    if (!this.enabled && this.touchedNodes.size === 0 && this.touchedElements.size === 0) return;
    this.enabled = false;
    this.strength = 0;
    this.pendingSubtrees.clear();
    this.pendingTextNodes.clear();
    this.teardownObserver();
    this.removeInitialPaintShield();
    this.restoreAll();
    if (this.targetObserverUnsub) {
      this.targetObserverUnsub();
      this.targetObserverUnsub = null;
    }
  },

  ensureTargetMarkers() {
    const selectors = getSiteSelectors(window.location?.hostname);
    markExisting(selectors.textVisualTargets, TARGET_ATTRS.TEXT_VISUAL, selectors.overlayExempt);
    if (!this.targetObserverUnsub) {
      this.targetObserverUnsub = subscribeToTargetChanges({
        selector: selectors.textVisualTargets,
        attr: TARGET_ATTRS.TEXT_VISUAL,
        overlayExemptSelector: selectors.overlayExempt,
      });
    }
  },

  restoreAll() {
    for (const node of Array.from(this.touchedNodes)) {
      if (!node || typeof node.nodeValue !== 'string') {
        this.touchedNodes.delete(node);
        continue;
      }
      const original = this.originalTextByNode.get(node);
      if (typeof original === 'string') node.nodeValue = original;
      this.originalTextByNode.delete(node);
      this.shuffledTextByNode.delete(node);
    }
    this.touchedNodes.clear();

    for (const el of Array.from(this.touchedElements)) {
      if (!el || !el.isConnected) {
        this.touchedElements.delete(el);
        continue;
      }
      el.removeAttribute('data-friction-shuffled');
    }
    this.touchedElements.clear();
  },

  maybeShieldInitialPaint() {
    if (this.initialPassDone) return;
    if (document.readyState !== 'loading') return;
    if (!document.documentElement) return;
    setRootAttribute(ROOT_ATTRS.TEXT_SHUFFLE_PENDING, '1');
  },

  removeInitialPaintShield() {
    if (!document.documentElement) return;
    removeRootAttribute(ROOT_ATTRS.TEXT_SHUFFLE_PENDING);
  },

  enqueueNode(node) {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      this.pendingTextNodes.add(node);
      return;
    }
    if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (const child of Array.from(node.childNodes || [])) this.enqueueNode(child);
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      this.pendingSubtrees.add(node);
    }
  },

  flushPending() {
    if (!this.enabled) {
      this.pendingSubtrees.clear();
      this.pendingTextNodes.clear();
      return;
    }

    const selectors = getSiteSelectors(window.location?.hostname);
    const overlayExemptSelector = selectors.overlayExempt;
    const excludedClosestSelector = selectors.textShuffleExcludedClosest;

    let processed = 0;

    for (const node of Array.from(this.pendingTextNodes)) {
      if (processed >= 400) break;
      if (this.shuffleTextNode(node, overlayExemptSelector, excludedClosestSelector)) processed++;
    }

    for (const subtree of Array.from(this.pendingSubtrees)) {
      if (processed >= 600) break;
      processed += this.applyToSubtree(subtree, overlayExemptSelector, excludedClosestSelector, 600 - processed);
    }

    this.pendingSubtrees.clear();
    this.pendingTextNodes.clear();
  },

  shuffleTextNode(node, overlayExemptSelector, excludedClosestSelector) {
    if (!node || typeof node.nodeValue !== 'string') return false;
    if (this.originalTextByNode.has(node)) return false;

    const parent = node.parentElement;
    if (!parent) return false;
    if (overlayExemptSelector && parent.closest(overlayExemptSelector)) return false;
    if (excludedClosestSelector && parent.closest(excludedClosestSelector)) return false;
    if (parent.isContentEditable) return false;

    const rawStrength = this.strength;
    const strength = Math.sqrt(rawStrength);
    const original = node.nodeValue ?? '';
    const trimmed = original.trim();
    if (!trimmed) return false;
    if (trimmed.length < 8) return false;
    if (trimmed.length > 2000) return false;

    const parts = original.split(/(\s+)/);
    const wordSlots = [];
    const words = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!part) continue;
      if (/^\s+$/.test(part)) continue;
      wordSlots.push(i);
      words.push(part);
    }

    if (words.length < 4) return false;
    if (words.length > 220) return false;
    if (Math.random() > strength) return false;

    this.originalTextByNode.set(node, original);
    this.touchedNodes.add(node);

    const kMax = Math.min(25, Math.floor(words.length / 2));
    if (kMax <= 0) return false;
    const k = Math.max(1, Math.round(strength * kMax));
    const swapChance = Math.min(1, strength * 1.2);
    const passes = rawStrength >= 0.85 ? 2 : 1;

    for (let pass = 0; pass < passes; pass++) {
      for (let i = 0; i < words.length; i++) {
        if (Math.random() > swapChance) continue;
        const offset = Math.floor(Math.random() * (2 * k + 1)) - k;
        if (offset === 0) continue;
        const j = Math.max(0, Math.min(words.length - 1, i + offset));
        if (j === i) continue;
        [words[i], words[j]] = [words[j], words[i]];
      }
    }

    for (let i = 0; i < wordSlots.length; i++) {
      parts[wordSlots[i]] = words[i];
    }
    node.nodeValue = parts.join('');
    this.shuffledTextByNode.set(node, node.nodeValue);

    if (parent instanceof HTMLElement) {
      parent.setAttribute('data-friction-shuffled', '1');
      this.touchedElements.add(parent);
    }
    return true;
  },

  applyToSubtree(rootNode, overlayExemptSelector, excludedClosestSelector, limit = 600) {
    if (!rootNode || limit <= 0) return 0;
    if (rootNode.nodeType === Node.TEXT_NODE) {
      return this.shuffleTextNode(rootNode, overlayExemptSelector, excludedClosestSelector) ? 1 : 0;
    }
    if (rootNode.nodeType !== Node.ELEMENT_NODE && rootNode.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return 0;

    const walker = document.createTreeWalker(
      rootNode,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          if (!node || typeof node.nodeValue !== 'string') return NodeFilter.FILTER_REJECT;
          if (this.originalTextByNode.has(node)) return NodeFilter.FILTER_REJECT;

          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          if (overlayExemptSelector && parent.closest(overlayExemptSelector)) return NodeFilter.FILTER_REJECT;
          if (excludedClosestSelector && parent.closest(excludedClosestSelector)) return NodeFilter.FILTER_REJECT;
          if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;

          const text = node.nodeValue.trim();
          if (!text) return NodeFilter.FILTER_REJECT;
          if (text.length < 8) return NodeFilter.FILTER_REJECT;
          if (text.length > 2000) return NodeFilter.FILTER_REJECT;

          const words = text.split(/\s+/).filter(Boolean);
          if (words.length < 4) return NodeFilter.FILTER_REJECT;
          if (words.length > 220) return NodeFilter.FILTER_REJECT;

          return NodeFilter.FILTER_ACCEPT;
        },
      },
      false
    );

    let processed = 0;
    while (processed < limit) {
      const node = walker.nextNode();
      if (!node) break;
      if (this.shuffleTextNode(node, overlayExemptSelector, excludedClosestSelector)) processed++;
    }
    return processed;
  },

  applyAll() {
    if (!this.enabled) return;

    const root = document.body || document.documentElement;
    if (!root) return;

    const selectors = getSiteSelectors(window.location?.hostname);
    const overlayExemptSelector = selectors.overlayExempt;
    const excludedClosestSelector = selectors.textShuffleExcludedClosest;

    this.applyToSubtree(root, overlayExemptSelector, excludedClosestSelector, 900);
    this.removeInitialPaintShield();
  },

  ensureObserver() {
    if (this.observerUnsub) return;
    this.observerUnsub = observerHub.subscribe(
      ({ addedNodes, textNodes }) => {
        for (const node of addedNodes) this.enqueueNode(node);
        for (const node of textNodes) this.enqueueNode(node);
        this.scheduleFlush();
      },
      { childList: true, subtree: true, characterData: true }
    );
  },

  scheduleFlush() {
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushPending();
    }, 120);
  },

  teardownObserver() {
    if (this.observerUnsub) {
      this.observerUnsub();
      this.observerUnsub = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  },
};

export default TextShuffleManager;
