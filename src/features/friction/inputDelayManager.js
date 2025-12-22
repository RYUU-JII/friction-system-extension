import { ROOT_ATTRS } from './constants.js';
import { setRootAttribute, removeRootAttribute } from './dom.js';

const InputDelayManager = {
  active: false,
  maxDelayMs: 0,
  boundInput: null,
  boundFocusIn: null,
  boundFocusOut: null,
  boundScroll: null,
  boundResize: null,
  rafPending: false,
  tracked: new Set(),
  stateByEl: new WeakMap(),

  apply(value) {
    const maxDelayMs = Number(value) || 0;
    if (maxDelayMs <= 0) {
      this.remove();
      return;
    }

    this.maxDelayMs = maxDelayMs;
    if (this.active) return;

    setRootAttribute(ROOT_ATTRS.INPUT_DELAY, '1');

    this.boundInput = this.handleInput.bind(this);
    this.boundFocusIn = this.handleFocusIn.bind(this);
    this.boundFocusOut = this.handleFocusOut.bind(this);
    this.boundScroll = this.handleAnyScroll.bind(this);
    this.boundResize = this.scheduleAllOverlaysUpdate.bind(this);

    document.addEventListener('focusin', this.boundFocusIn, true);
    document.addEventListener('focusout', this.boundFocusOut, true);
    document.addEventListener('input', this.boundInput, true);
    document.addEventListener('scroll', this.boundScroll, true);
    window.addEventListener('resize', this.boundResize, true);
    this.active = true;
  },

  remove() {
    if (!this.active) {
      this.maxDelayMs = 0;
      return;
    }

    document.removeEventListener('focusin', this.boundFocusIn, true);
    document.removeEventListener('focusout', this.boundFocusOut, true);
    document.removeEventListener('input', this.boundInput, true);
    document.removeEventListener('scroll', this.boundScroll, true);
    window.removeEventListener('resize', this.boundResize, true);

    this.boundInput = null;
    this.boundFocusIn = null;
    this.boundFocusOut = null;
    this.boundScroll = null;
    this.boundResize = null;

    for (const el of Array.from(this.tracked)) {
      this.cleanupElement(el);
    }
    this.tracked.clear();
    this.stateByEl = new WeakMap();

    removeRootAttribute(ROOT_ATTRS.INPUT_DELAY);

    this.maxDelayMs = 0;
    this.active = false;
  },

  isTextInput(el) {
    if (!el) return false;
    if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
    if (!(el instanceof HTMLInputElement)) return false;
    const disallowedTypes = new Set([
      'checkbox',
      'radio',
      'range',
      'color',
      'file',
      'submit',
      'button',
      'image',
      'reset',
      'hidden',
      'password',
    ]);
    if (disallowedTypes.has(el.type)) return false;
    return !el.readOnly && !el.disabled;
  },

  pickDelayMs() {
    const max = Math.max(0, this.maxDelayMs || 0);
    if (max <= 0) return 0;

    const strength = Math.max(0, Math.min(1, max / 500));
    const noDelayChance = 0.25 - strength * 0.18;
    const spikeChance = 0.05 + strength * 0.15;

    const r = Math.random();
    if (r < noDelayChance) return 0;

    const randInt = (a, b) => {
      const lo = Math.min(a, b);
      const hi = Math.max(a, b);
      return lo + Math.floor(Math.random() * (hi - lo + 1));
    };

    if (r < noDelayChance + spikeChance) return randInt(max, Math.round(max * 3));

    const min = Math.max(15, Math.round(max * 0.25));
    return randInt(min, max);
  },

  ensureElementState(el) {
    const existing = this.stateByEl.get(el);
    if (existing) return existing;

    const overlay = document.createElement('div');
    overlay.className = 'friction-input-overlay';
    const inner = document.createElement('div');
    inner.className = 'friction-input-overlay__inner';
    const content = document.createElement('div');
    content.className = 'friction-input-overlay__content';
    inner.appendChild(content);
    overlay.appendChild(inner);
    (document.documentElement || document.body).appendChild(overlay);

    let caret = '';
    let placeholderColor = '';
    const snapshot = {
      padding: '',
      font: '',
      letterSpacing: '',
      textAlign: '',
      lineHeight: '',
      color: '',
      textIndent: '',
      direction: '',
      borderTopWidth: '',
      borderRightWidth: '',
      borderBottomWidth: '',
      borderLeftWidth: '',
      borderRadius: '',
    };
    try {
      const cs = getComputedStyle(el);
      caret = cs.caretColor && cs.caretColor !== 'auto' ? cs.caretColor : cs.color;
      snapshot.padding = cs.padding;
      snapshot.font = cs.font;
      snapshot.letterSpacing = cs.letterSpacing;
      snapshot.textAlign = cs.textAlign;
      snapshot.lineHeight = cs.lineHeight;
      snapshot.color = cs.color;
      snapshot.textIndent = cs.textIndent;
      snapshot.direction = cs.direction;
      snapshot.borderTopWidth = cs.borderTopWidth;
      snapshot.borderRightWidth = cs.borderRightWidth;
      snapshot.borderBottomWidth = cs.borderBottomWidth;
      snapshot.borderLeftWidth = cs.borderLeftWidth;
      snapshot.borderRadius = cs.borderRadius;
      placeholderColor = getComputedStyle(el, '::placeholder')?.color || '';
    } catch (_) {}

    if (caret) el.style.setProperty('--friction-caret-color', caret);
    if (placeholderColor) el.style.setProperty('--friction-placeholder-color', placeholderColor);
    el.setAttribute('data-friction-input-delay', '1');

    const state = {
      el,
      overlay,
      inner,
      content,
      displayedValue: typeof el.value === 'string' ? el.value : '',
      snapshot,
      queue: [],
      running: false,
    };

    content.textContent = state.displayedValue;
    this.stateByEl.set(el, state);
    this.tracked.add(el);
    this.updateOverlay(state);
    return state;
  },

  cleanupElement(el) {
    const st = this.stateByEl.get(el);
    if (!st) return;

    try {
      st.overlay.remove();
    } catch (_) {}

    try {
      el.removeAttribute('data-friction-input-delay');
      el.style.removeProperty('--friction-caret-color');
      el.style.removeProperty('--friction-placeholder-color');
    } catch (_) {}

    this.stateByEl.delete(el);
    this.tracked.delete(el);
  },

  updateOverlay(state) {
    if (!state || !state.el || !state.overlay || !state.content) return;
    const el = state.el;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      state.overlay.style.visibility = 'hidden';
      return;
    }
    state.overlay.style.visibility = 'visible';
    state.overlay.style.left = `${rect.left}px`;
    state.overlay.style.top = `${rect.top}px`;
    state.overlay.style.width = `${rect.width}px`;
    state.overlay.style.height = `${rect.height}px`;

    const cs = getComputedStyle(el);
    const snap = state.snapshot;
    state.content.style.padding = snap.padding || cs.padding;
    state.content.style.font = snap.font || cs.font;
    state.content.style.letterSpacing = snap.letterSpacing || cs.letterSpacing;
    state.content.style.textAlign = snap.textAlign || cs.textAlign;
    state.content.style.lineHeight = snap.lineHeight || cs.lineHeight;
    state.content.style.color = snap.color || cs.color;
    state.content.style.textIndent = snap.textIndent || cs.textIndent;
    state.content.style.direction = snap.direction || cs.direction;
    state.content.style.borderTopWidth = snap.borderTopWidth || cs.borderTopWidth;
    state.content.style.borderRightWidth = snap.borderRightWidth || cs.borderRightWidth;
    state.content.style.borderBottomWidth = snap.borderBottomWidth || cs.borderBottomWidth;
    state.content.style.borderLeftWidth = snap.borderLeftWidth || cs.borderLeftWidth;
    state.content.style.borderRadius = snap.borderRadius || cs.borderRadius;
    state.overlay.style.padding = '0';
    state.overlay.style.margin = '0';
    state.overlay.style.border = cs.border;
    state.overlay.style.boxSizing = cs.boxSizing;
    state.overlay.style.borderRadius = snap.borderRadius || cs.borderRadius;
    state.overlay.style.pointerEvents = 'none';
  },

  scheduleAllOverlaysUpdate() {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      for (const el of Array.from(this.tracked)) {
        const st = this.stateByEl.get(el);
        if (st) this.updateOverlay(st);
      }
    });
  },

  enqueueValue(state, value) {
    const v = typeof value === 'string' ? value : String(value ?? '');
    const delayMs = this.pickDelayMs();

    if (delayMs <= 0) {
      state.queue.length = 0;
      state.displayedValue = v;
      state.content.textContent = v;
      return;
    }

    state.queue.push({ value: v, delayMs });
    if (state.queue.length > 12) {
      state.queue.splice(0, state.queue.length - 12);
    }
    this.runQueue(state);
  },

  runQueue(state) {
    if (state.running) return;
    const item = state.queue.shift();
    if (!item) return;

    state.running = true;
    setTimeout(() => {
      state.running = false;
      state.displayedValue = item.value;
      if (state.content) state.content.textContent = item.value;
      this.updateOverlay(state);
      this.runQueue(state);
    }, item.delayMs);
  },

  handleFocusIn(e) {
    if (!this.active || this.maxDelayMs <= 0) return;
    const target = e.target;
    if (!this.isTextInput(target)) return;
    if (target instanceof HTMLElement && target.isContentEditable) return;
    this.ensureElementState(target);
    this.scheduleAllOverlaysUpdate();
  },

  handleFocusOut(e) {
    if (!this.active) return;
    const target = e.target;
    if (!this.isTextInput(target)) return;
    const st = this.stateByEl.get(target);
    if (st) this.updateOverlay(st);
  },

  handleInput(e) {
    if (!this.active || this.maxDelayMs <= 0) return;
    const target = e.target;
    if (!this.isTextInput(target)) return;
    if (target instanceof HTMLElement && target.isContentEditable) return;

    const st = this.ensureElementState(target);
    this.enqueueValue(st, target.value || '');
    this.updateOverlay(st);
  },

  handleAnyScroll(e) {
    if (!this.active) return;
    const target = e.target;
    if (this.isTextInput(target)) {
      const st = this.stateByEl.get(target);
      if (st) this.updateOverlay(st);
      return;
    }

    this.scheduleAllOverlaysUpdate();
  },
};

export default InputDelayManager;
