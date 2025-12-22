class ObserverHub {
  constructor() {
    this.subscribers = new Map();
    this.observer = null;
    this.pendingMutations = [];
    this.flushScheduled = false;
    this.activeOptions = null;
  }

  subscribe(handler, options = {}) {
    if (typeof handler !== 'function') return () => {};
    const token = Symbol('observerHubSubscriber');
    const normalized = {
      childList: !!options.childList,
      subtree: options.subtree !== undefined ? !!options.subtree : true,
      characterData: !!options.characterData,
      attributes: !!options.attributes,
    };

    this.subscribers.set(token, { handler, options: normalized });
    this._ensureObserver();
    return () => this.unsubscribe(token);
  }

  unsubscribe(token) {
    if (!this.subscribers.has(token)) return;
    this.subscribers.delete(token);
    this._ensureObserver();
  }

  _ensureObserver() {
    if (this.subscribers.size === 0) {
      this._disconnect();
      return;
    }

    const merged = this._mergeOptions();
    const shouldReconnect =
      !this.activeOptions ||
      Object.keys(merged).some((key) => merged[key] !== this.activeOptions[key]);

    if (!this.observer) {
      this.observer = new MutationObserver((mutations) => this._handleMutations(mutations));
    }

    if (shouldReconnect) {
      this._disconnect();
      this.activeOptions = merged;
      try {
        const root = document.documentElement || document;
        this.observer.observe(root, merged);
      } catch (_) {
        // ignore
      }
    }
  }

  _mergeOptions() {
    const merged = {
      childList: false,
      subtree: false,
      characterData: false,
      attributes: false,
    };

    for (const { options } of this.subscribers.values()) {
      merged.childList = merged.childList || options.childList;
      merged.subtree = merged.subtree || options.subtree;
      merged.characterData = merged.characterData || options.characterData;
      merged.attributes = merged.attributes || options.attributes;
    }

    if (merged.characterData || merged.attributes) {
      merged.subtree = true;
    }

    return merged;
  }

  _disconnect() {
    if (!this.observer) return;
    try {
      this.observer.disconnect();
    } catch (_) {}
  }

  _handleMutations(mutations) {
    if (!mutations || mutations.length === 0) return;
    this.pendingMutations.push(...mutations);
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    requestAnimationFrame(() => this._flush());
  }

  _flush() {
    this.flushScheduled = false;
    if (this.pendingMutations.length === 0) return;

    const batch = this.pendingMutations;
    this.pendingMutations = [];

    const addedNodes = new Set();
    const textNodes = new Set();
    const attributeTargets = new Set();

    for (const mutation of batch) {
      if (mutation.type === 'childList') {
        mutation.addedNodes?.forEach((node) => addedNodes.add(node));
      } else if (mutation.type === 'characterData') {
        if (mutation.target) textNodes.add(mutation.target);
      } else if (mutation.type === 'attributes') {
        if (mutation.target) attributeTargets.add(mutation.target);
      }
    }

    const payload = {
      mutations: batch,
      addedNodes: Array.from(addedNodes),
      textNodes: Array.from(textNodes),
      attributeTargets: Array.from(attributeTargets),
    };

    for (const { handler } of this.subscribers.values()) {
      try {
        handler(payload);
      } catch (_) {
        // ignore subscriber errors
      }
    }
  }
}

const observerHub = new ObserverHub();

export default observerHub;
