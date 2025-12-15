// contentScript.js (수정됨: 이중 필터 및 안정성 개선)

/**
 * [마찰 시스템 구조]
 * 1. Constants & State: 상수 및 현재 상태 관리 (NEW: isAnyClickDelayed 추가)
 * 2. Selectors: CSS 선택자 중앙 관리
 * 3. Managers: 각 필터 그룹별 로직 분리 (Visual, Text, Interaction - NEW: handleClick 대폭 수정)
 * 4. Main Controller: 메시지 수신 및 분배
 * 5. Helpers: 시간 체크 헬퍼
 * 6. Early Filter Application: FOUC 방지 로직
 */

/// ===========================================================
// 1. Constants & State
// ===========================================================
import { isFrictionTime, getHostname } from "./utils/utils";

const STYLES = {
    VISUAL: { ID: 'friction-visual-style', ATTR: 'data-visual-applied' },
    DELAY: { ID: 'friction-delay-style', ATTR: 'data-delay-applied' },
    SPACING: { ID: 'friction-spacing-style', ATTR: 'data-spacing-applied' },
    TEXT_SHUFFLE: { ID: 'friction-text-shuffle-style', ATTR: 'data-text-shuffle-pending' }
};

const ATTRS = {
    CLICK: 'data-click-delay-active',
    SCROLL: 'data-scroll-friction-active',
};

// 전역 상태 관리
const state = {
    clickDelayTime: 0,
    scrollDelayTime: 0,
    scrollAccumulator: { x: 0, y: 0 },
    scrollTimer: null,
    scrollActive: false,
    isAnyClickDelayed: false,
};

// ===========================================================
// 2. Selectors (중앙 관리)
// ===========================================================

const SELECTORS = {
    // VISUAL_TARGETS: "틀(컨테이너)"이 아닌 "콘텐츠(미디어/이미지)"에만 적용해 중첩 필터(누적 blur/grayscale)를 방지합니다.
    // - 컨테이너(예: article, p, li, a 등)에 filter를 걸면 자식까지 합성되어 단계적으로 옅어지는 현상이 생길 수 있습니다.
    // - X(트위터) 모달/포토 뷰어도 컨테이너 filter에 의해 "열리지만 안 보이는" 문제가 발생할 수 있어, 타겟을 leaf로 제한합니다.
    VISUAL_TARGETS: ':is(img, picture, video, canvas, svg, [role="img"], [data-testid="tweetPhoto"] [style*="background-image"], [style*="background-image"]:not(:has(img, video, canvas, svg)), #thumbnail img, [id="thumbnail"] img, .thumbnail img, .thumb img, [class*="thumbnail"] img, [class*="thumb"] img, ytd-thumbnail img, ytd-rich-grid-media img, ytd-compact-video-renderer img, ytd-reel-video-renderer img)',
    
    // INTERACTIVE_TARGETS는 네비게이션 및 인터랙션 요소를 포괄하도록 확장되었습니다.
    INTERACTIVE_TARGETS: ':is(a, button, article, [onclick], input[type="submit"], input[type="image"], [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="article"], [role="menuitem"], [role="option"], [role="tab"], [class*="link"], [class*="button"], [class*="btn"], figure):not(.stickyunit)',
    
    TEXT_LAYOUT_TARGETS: ':is(p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, a)',
    TEXT_VISUAL_TARGETS: ':is(span:not([role]), a:not(:has(img, video, canvas, svg)), p:not(:has(img, video, canvas, svg)), li:not(:has(img, video, canvas, svg)), h1:not(:has(img, video, canvas, svg)), h2:not(:has(img, video, canvas, svg)), h3:not(:has(img, video, canvas, svg)), h4:not(:has(img, video, canvas, svg)), h5:not(:has(img, video, canvas, svg)), h6:not(:has(img, video, canvas, svg)), blockquote:not(:has(img, video, canvas, svg)))',
    TEXT_TARGETS: ':is(p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, a)'
};

// ===========================================================
// 3. Filter Managers
// ===========================================================

// ✨ Helper: DOMContentLoaded 이전에도 안전하게 속성을 설정할 수 있도록 <html> 태그를 타겟팅합니다.
const setRootAttribute = (attr, value) => {
    if (!document.documentElement) return;
    document.documentElement.setAttribute(attr, value);
};
const removeRootAttribute = (attr) => {
    if (!document.documentElement) return;
    document.documentElement.removeAttribute(attr);
};

const VisualManager = {
    update(filters) {
        const blur = filters.blur;
        const desat = filters.desaturation;
        const mediaBrightness = filters.mediaBrightness;
        const mediaOpacity = filters.mediaOpacity;

        const isActive =
            (blur && blur.isActive) ||
            (desat && desat.isActive) ||
            (mediaBrightness && mediaBrightness.isActive) ||
            (mediaOpacity && mediaOpacity.isActive);

        if (!isActive) {
            this.remove();
            return;
        }

        const filterValues = [];
        if (blur && blur.isActive) filterValues.push(`blur(${blur.value})`);
        if (desat && desat.isActive) filterValues.push(`grayscale(${desat.value})`);
        if (mediaBrightness && mediaBrightness.isActive) filterValues.push(`brightness(${mediaBrightness.value})`);

        const combinedFilter = filterValues.length > 0 ? filterValues.join(' ') : 'none';
        
        let style = document.getElementById(STYLES.VISUAL.ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLES.VISUAL.ID;
            document.head.appendChild(style);
        }

        // ✨ 핵심 수정: html 태그의 속성을 확인하고, will-change를 제거했습니다.
        // ✨ 핵심 추가: :has(:hover)를 통해 이중 필터링을 방지합니다.
        const overlayExempt = ':is([role="dialog"], [aria-modal="true"])';
        const opacityRule = mediaOpacity && mediaOpacity.isActive ? `opacity: ${mediaOpacity.value} !important;` : '';

        style.textContent = `
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_TARGETS} {
                filter: ${combinedFilter} !important;
                ${opacityRule}
                transition: filter 0.1s ease, opacity 0.1s ease;
                /* will-change: filter; 제거 */
            }
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_TARGETS}:hover {
                filter: none !important;
                opacity: 1 !important;
            }
            /* 이중 필터 버그 수정: 자식 요소가 호버되면 부모 필터도 해제 */
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_TARGETS}:has(:hover) {
                filter: none !important;
                opacity: 1 !important;
            }

            /* 오버레이/모달은 시각 필터에서 제외: X 사진 팝업이 "열리지만 안 보이는" 현상 방지 */
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${overlayExempt},
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${overlayExempt} * {
                filter: none !important;
                opacity: 1 !important;
            }
        `;
        setRootAttribute(STYLES.VISUAL.ATTR, 'active');
    },

    remove() {
        const style = document.getElementById(STYLES.VISUAL.ID);
        if (style) style.remove();
        setRootAttribute(STYLES.VISUAL.ATTR, 'none');
    }
};

const DelayManager = {
    apply(value) {
        let style = document.getElementById(STYLES.DELAY.ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLES.DELAY.ID;
            document.head.appendChild(style);
        }

        style.textContent = `
            html:not([${STYLES.DELAY.ATTR}="none"]) ${SELECTORS.INTERACTIVE_TARGETS} {
                transition: all ${value} ease !important;
            }
        `;
        setRootAttribute(STYLES.DELAY.ATTR, 'active');
    },

    remove() {
        const style = document.getElementById(STYLES.DELAY.ID);
        if (style) style.remove();
        setRootAttribute(STYLES.DELAY.ATTR, 'none');
    }
};

const TextManager = {
    update(filters) {
        const spacing = filters.letterSpacing;
        const lineHeight = filters.lineHeight;
        const textOpacity = filters.textOpacity;
        const textBlur = filters.textBlur;
        const textShadow = filters.textShadow;

        const isActive =
            (spacing && spacing.isActive) ||
            (lineHeight && lineHeight.isActive) ||
            (textOpacity && textOpacity.isActive) ||
            (textBlur && textBlur.isActive) ||
            (textShadow && textShadow.isActive);

        if (!isActive) {
            this.remove();
            return;
        }

        let style = document.getElementById(STYLES.SPACING.ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLES.SPACING.ID;
            document.head.appendChild(style);
        }

        const overlayExempt = ':is([role="dialog"], [aria-modal="true"])';
        const spacingValue = spacing && spacing.isActive ? spacing.value : 'normal';
        const lineHeightValue = lineHeight && lineHeight.isActive ? lineHeight.value : 'normal';
        const opacityValue = textOpacity && textOpacity.isActive ? textOpacity.value : null;
        const blurValue = textBlur && textBlur.isActive ? textBlur.value : null;
        const shadowValue = textShadow && textShadow.isActive ? textShadow.value : null;

        const visualTextRules = (opacityValue || blurValue || shadowValue)
            ? `
                ${SELECTORS.TEXT_VISUAL_TARGETS} {
                    ${opacityValue ? `opacity: ${opacityValue} !important;` : ''}
                    ${blurValue ? `filter: blur(${blurValue}) !important;` : ''}
                    ${shadowValue ? `text-shadow: ${shadowValue} !important;` : ''}
                    transition: opacity 0.15s ease, filter 0.15s ease, text-shadow 0.15s ease;
                }
            `
            : '';

        style.textContent = `
            ${SELECTORS.TEXT_LAYOUT_TARGETS} {
                letter-spacing: ${spacingValue} !important;
                line-height: ${lineHeightValue} !important;
                transition: letter-spacing 0.3s ease, line-height 0.3s ease;
            }
            ${visualTextRules}

            /* 오버레이/모달은 텍스트 시각 필터에서도 제외 */
            ${overlayExempt},
            ${overlayExempt} * {
                opacity: 1 !important;
                filter: none !important;
                text-shadow: none !important;
                letter-spacing: normal !important;
                line-height: normal !important;
            }
        `;

        setRootAttribute(STYLES.SPACING.ATTR, 'active');
    },

    remove() {
        const style = document.getElementById(STYLES.SPACING.ID);
        if (style) style.remove();
        setRootAttribute(STYLES.SPACING.ATTR, 'none');
    },

    applySpacing(value) {
        let style = document.getElementById(STYLES.SPACING.ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLES.SPACING.ID;
            document.head.appendChild(style);
        }

        style.textContent = `
            ${SELECTORS.TEXT_TARGETS} {
                letter-spacing: ${value} !important;
                transition: letter-spacing 0.3s ease;
            }
        `;
        // TextManager의 CSS는 <body> 속성을 사용하지 않으므로 그대로 유지하거나, 통일할 수 있습니다.
        // 여기서는 기존 코드를 따라 document.body를 사용하지만, 문서 시작 시점에 안정성을 높였습니다.
        const targetElement = document.body || document.documentElement;
        if(targetElement) targetElement.setAttribute(STYLES.SPACING.ATTR, 'active');
    },

    removeSpacing() {
        const style = document.getElementById(STYLES.SPACING.ID);
        if (style) style.remove();
        const targetElement = document.body || document.documentElement;
        if(targetElement) targetElement.removeAttribute(STYLES.SPACING.ATTR);
    },
};

const TextShuffleManager = {
    enabled: false,
    strength: 0,
    touchedElements: new Set(),
    touchedNodes: new Set(),
    originalTextByNode: new WeakMap(),
    observer: null,
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
    },

    ensureObserver() {
        if (this.observer) return;
        this.observer = new MutationObserver((mutations) => {
            if (!this.enabled) return;

            for (const mutation of mutations) {
                if (mutation.type === 'childList') {
                    for (const addedNode of mutation.addedNodes) {
                        this.enqueueNode(addedNode);
                    }
                } else if (mutation.type === 'characterData') {
                    this.enqueueNode(mutation.target);
                }
            }

            if (this.debounceTimer) clearTimeout(this.debounceTimer);
            this.debounceTimer = setTimeout(() => this.flushPending(), 200);
        });
        this.observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    },

    teardownObserver() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
        this.debounceTimer = null;
        if (this.observer) this.observer.disconnect();
        this.observer = null;
    },

    restoreAll() {
        for (const node of Array.from(this.touchedNodes)) {
            if (!node || !node.isConnected) {
                this.touchedNodes.delete(node);
                continue;
            }
            const original = this.originalTextByNode.get(node);
            if (typeof original === 'string') node.nodeValue = original;
        }
        this.touchedNodes.clear();
        this.originalTextByNode = new WeakMap();

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

        let style = document.getElementById(STYLES.TEXT_SHUFFLE.ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLES.TEXT_SHUFFLE.ID;
            style.textContent = `
                html[${STYLES.TEXT_SHUFFLE.ATTR}="1"] ${SELECTORS.TEXT_VISUAL_TARGETS} {
                    visibility: hidden !important;
                }
            `;

            const mount = document.head || document.documentElement;
            mount.appendChild(style);
        }

        document.documentElement.setAttribute(STYLES.TEXT_SHUFFLE.ATTR, '1');
    },

    removeInitialPaintShield() {
        if (!document.documentElement) return;
        document.documentElement.removeAttribute(STYLES.TEXT_SHUFFLE.ATTR);
        const style = document.getElementById(STYLES.TEXT_SHUFFLE.ID);
        if (style) style.remove();
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

        const overlayExemptSelector = ':is([role="dialog"], [aria-modal="true"])';
        const excludedClosestSelector = [
            'script',
            'style',
            'noscript',
            'textarea',
            'input',
            'select',
            'option',
            'pre',
            'code',
            'svg',
            'math',
            '[contenteditable="true"]',
            '[contenteditable=""]'
        ].join(', ');

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
        if (parent.closest(overlayExemptSelector)) return false;
        if (parent.closest(excludedClosestSelector)) return false;
        if (parent.isContentEditable) return false;

        const rawStrength = this.strength;
        // Make low values more noticeable without adding extra passes/complexity.
        // Keeps 0 => 0, but lifts the low end (e.g. 0.1 -> ~0.316).
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

        // Target selection probability (lifted curve): lower values still touch fewer nodes (CPU-friendly).
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
                    if (parent.closest(overlayExemptSelector)) return NodeFilter.FILTER_REJECT;
                    if (parent.closest(excludedClosestSelector)) return NodeFilter.FILTER_REJECT;
                    if (parent.isContentEditable) return NodeFilter.FILTER_REJECT;

                    const text = node.nodeValue.trim();
                    if (!text) return NodeFilter.FILTER_REJECT;
                    if (text.length < 8) return NodeFilter.FILTER_REJECT;
                    if (text.length > 2000) return NodeFilter.FILTER_REJECT;

                    const words = text.split(/\s+/).filter(Boolean);
                    if (words.length < 4) return NodeFilter.FILTER_REJECT;
                    if (words.length > 220) return NodeFilter.FILTER_REJECT;

                    return NodeFilter.FILTER_ACCEPT;
                }
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

        const overlayExemptSelector = ':is([role="dialog"], [aria-modal="true"])';
        const excludedClosestSelector = [
            'script',
            'style',
            'noscript',
            'textarea',
            'input',
            'select',
            'option',
            'pre',
            'code',
            'svg',
            'math',
            '[contenteditable="true"]',
            '[contenteditable=""]'
        ].join(', ');

        this.applyToSubtree(root, overlayExemptSelector, excludedClosestSelector, 900);
        this.removeInitialPaintShield();
    }
};

const InputDelayManager = {
    active: false,
    delayMs: 0,
    composing: false,
    boundBeforeInput: null,
    boundPaste: null,
    boundCompositionStart: null,
    boundCompositionEnd: null,

    apply(value) {
        const delayMs = Number(value) || 0;
        if (delayMs <= 0) {
            this.remove();
            return;
        }

        this.delayMs = delayMs;
        if (this.active) return;

        this.boundBeforeInput = this.handleBeforeInput.bind(this);
        this.boundPaste = this.handlePaste.bind(this);
        this.boundCompositionStart = () => { this.composing = true; };
        this.boundCompositionEnd = () => { this.composing = false; };

        document.addEventListener('compositionstart', this.boundCompositionStart, true);
        document.addEventListener('compositionend', this.boundCompositionEnd, true);
        document.addEventListener('beforeinput', this.boundBeforeInput, true);
        document.addEventListener('paste', this.boundPaste, true);
        this.active = true;
    },

    remove() {
        if (!this.active) {
            this.delayMs = 0;
            this.composing = false;
            return;
        }

        document.removeEventListener('compositionstart', this.boundCompositionStart, true);
        document.removeEventListener('compositionend', this.boundCompositionEnd, true);
        document.removeEventListener('beforeinput', this.boundBeforeInput, true);
        document.removeEventListener('paste', this.boundPaste, true);

        this.boundBeforeInput = null;
        this.boundPaste = null;
        this.boundCompositionStart = null;
        this.boundCompositionEnd = null;

        this.delayMs = 0;
        this.composing = false;
        this.active = false;
    },

    isTextInput(el) {
        if (!el) return false;
        if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
        if (!(el instanceof HTMLInputElement)) return false;
        const disallowedTypes = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'submit', 'button', 'image', 'reset', 'hidden']);
        if (disallowedTypes.has(el.type)) return false;
        return !el.readOnly && !el.disabled;
    },

    handleBeforeInput(e) {
        if (!this.active || this.delayMs <= 0) return;
        if (e.isComposing || this.composing) return;

        const target = e.target;
        if (!this.isTextInput(target)) return;
        if (target instanceof HTMLElement && target.isContentEditable) return;

        const inputType = e.inputType || '';
        if (inputType.startsWith('insertFromPaste')) return;

        const supported = new Set(['insertText', 'deleteContentBackward', 'deleteContentForward']);
        if (!supported.has(inputType)) return;

        e.preventDefault();
        e.stopImmediatePropagation();

        const data = e.data;
        const action = () => {
            try {
                const start = target.selectionStart ?? 0;
                const end = target.selectionEnd ?? start;

                if (inputType === 'insertText') {
                    const text = data ?? '';
                    target.setRangeText(text, start, end, 'end');
                } else if (inputType === 'deleteContentBackward') {
                    if (start !== end) target.setRangeText('', start, end, 'end');
                    else if (start > 0) target.setRangeText('', start - 1, start, 'end');
                } else if (inputType === 'deleteContentForward') {
                    if (start !== end) target.setRangeText('', start, end, 'end');
                    else target.setRangeText('', start, Math.min((target.value || '').length, start + 1), 'end');
                }

                target.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (_) {
                // no-op: fail safe to avoid breaking input
            }
        };

        setTimeout(action, this.delayMs);
    },

    handlePaste(e) {
        if (!this.active || this.delayMs <= 0) return;
        if (e.isComposing || this.composing) return;

        const target = e.target;
        if (!this.isTextInput(target)) return;
        if (target instanceof HTMLElement && target.isContentEditable) return;

        const text = e.clipboardData?.getData('text');
        if (typeof text !== 'string') return;

        e.preventDefault();
        e.stopImmediatePropagation();

        setTimeout(() => {
            try {
                const start = target.selectionStart ?? 0;
                const end = target.selectionEnd ?? start;
                target.setRangeText(text, start, end, 'end');
                target.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (_) {
                // no-op
            }
        }, this.delayMs);
    }
};

const InteractionManager = {
    handleClick(e) {
        const el = e.target.closest(SELECTORS.INTERACTIVE_TARGETS);
     
        if (!el) return;

        // ⭐️ [이전 수정]: 클릭된 실제 요소가 <img> 태그라면 즉시 우회
        if (e.target.tagName === 'IMG') {
             return;
        }

        // ⭐️ [추가 수정 로직: X 사진 링크 구조 대응]
        // 1. 클릭된 요소의 가장 가까운 부모 중 A 태그를 찾는다.
        const parentAnchor = e.target.closest('a');
        
        // 2. 만약 A 태그가 존재하고, 그 A 태그 내부에 IMG 태그가 포함되어 있다면 (사진 링크로 간주)
        if (parentAnchor && parentAnchor.querySelector('img')) {
            // 이 클릭은 X의 사진 팝업을 위한 것이므로 지연을 적용하지 않고 즉시 종료(우회)
            return;
        }

        // 1. 이전 타이머 취소
        const existingTimerId = el.dataset.frictionTimerId;
        
        if (existingTimerId) {
            clearTimeout(Number(existingTimerId));
            delete el.dataset.frictionTimerId;
            el.dataset.frictionClicking = '';
            el.style.opacity = '';
            el.style.pointerEvents = '';
        }

        // 2. 전역 지연 중이면 무시
        if (state.isAnyClickDelayed && el.dataset.frictionClicking !== 'bypass') {
             e.preventDefault();
             e.stopImmediatePropagation();
             return;
        }

        // ⭐️ 3. [수정됨] 네비게이션 및 인터랙션 타겟 검증 강화
        const isNavigationTarget = 
            el.tagName === 'A' || 
            el.tagName === 'BUTTON' || 
            el.tagName === 'ARTICLE' || 
            el.tagName === 'FIGURE' ||
            el.hasAttribute('href') || 
            el.hasAttribute('onclick') ||
            el.matches('input[type="submit"]') ||
            el.matches('input[type="image"]') ||
            
            // ARIA Role 검증 강화
            el.getAttribute('role') === 'link' ||
            el.getAttribute('role') === 'button' ||
            el.getAttribute('role') === 'article' ||
            el.getAttribute('role') === 'menuitem' ||
            el.getAttribute('role') === 'option' ||
            el.getAttribute('role') === 'tab' ||
            // 상태 변경 요소 포함
            el.getAttribute('role') === 'checkbox' ||
            el.getAttribute('role') === 'radio' ||
            el.getAttribute('role') === 'switch';

        if (!isNavigationTarget) {
            return;
        }

        // 4. 바이패스 (실제 실행)
        if (el.dataset.frictionClicking === 'bypass') {
            el.dataset.frictionClicking = ''; 
            state.isAnyClickDelayed = false; 
            return; 
        }

        // --- 5. 지연 시작 ---
        if (!document.body.contains(el)) return; 

        e.preventDefault(); 
        e.stopImmediatePropagation(); 

        el.dataset.frictionClicking = 'true';
        state.isAnyClickDelayed = true;

        let originalOpacity = '';
        let isArticle = el.tagName === 'ARTICLE'; 

        // article 태그가 아닌 경우에만 불투명도 및 포인터 이벤트를 변경
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
            
            // article 태그가 아닌 경우에만 스타일을 복원합니다.
            if (!isArticle) {
                el.style.opacity = originalOpacity;
                el.style.pointerEvents = '';
            }
            
            delete el.dataset.frictionTimerId;
            el.dataset.frictionClicking = 'bypass'; 

            // 1. [CSP 우회 로직]: href에 'javascript:'가 있는지 확인
            const originalHref = el.getAttribute('href');
            let isJsUrl = originalHref && originalHref.toLowerCase().startsWith('javascript:');

            if (isJsUrl) {
                // 2. CSP 위반을 피하기 위해 임시로 href 제거
                el.removeAttribute('href');
            }

            el.click(); // 원본 클릭 실행 (이때 onclick이 실행됨)
            
            if (isJsUrl) {
                // 3. href 속성 복원
                el.setAttribute('href', originalHref);
            }
            
        }, state.clickDelayTime);

        el.dataset.frictionTimerId = timerId;
    },

    applyClickDelay(value) {
        // 속성 타겟을 document.documentElement로 통일
        if (document.documentElement.getAttribute(ATTRS.CLICK) === 'active') return;
        state.clickDelayTime = value;
        document.body.addEventListener('click', this.handleClick, true);
        setRootAttribute(ATTRS.CLICK, 'active');
    },

    removeClickDelay() {
        if (document.documentElement.getAttribute(ATTRS.CLICK) === 'active') {
            document.body.removeEventListener('click', this.handleClick, true);
            setRootAttribute(ATTRS.CLICK, 'none');
        }
    },

    handleWheel(e) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        state.scrollAccumulator.x += e.deltaX;
        state.scrollAccumulator.y += e.deltaY;

        if (state.scrollTimer) clearTimeout(state.scrollTimer);

        state.scrollTimer = setTimeout(() => {
            window.scrollBy({
                left: state.scrollAccumulator.x,
                top: state.scrollAccumulator.y,
                behavior: 'instant'
            });
            
            document.documentElement.scrollTop += state.scrollAccumulator.y;

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
    }
};


// ===========================================================
// 4. Main Controller
// ===========================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (!request.isBlocked) {
          VisualManager.remove();
          DelayManager.remove();
          TextManager.remove();
          TextShuffleManager.disable();
          InputDelayManager.remove();
          InteractionManager.removeClickDelay();
          InteractionManager.removeScroll();
          return;
      }

    const { filters } = request;
    
    VisualManager.update(filters);

    if (filters.delay?.isActive) DelayManager.apply(filters.delay.value);
    else DelayManager.remove();

    if (filters.inputDelay?.isActive) InputDelayManager.apply(filters.inputDelay.value);
    else InputDelayManager.remove();

    if (filters.clickDelay?.isActive) InteractionManager.applyClickDelay(filters.clickDelay.value);
    else InteractionManager.removeClickDelay();

    if (filters.scrollFriction?.isActive) InteractionManager.applyScroll(filters.scrollFriction.value);
    else InteractionManager.removeScroll();

      TextManager.update(filters);
      TextShuffleManager.update(filters.textShuffle);
  });

// ===========================================================
// 6. Early Filter Application
// ===========================================================

chrome.storage.local.get({
    blockedUrls: [], 
    schedule: { scheduleActive: false, startMin: 0, endMin: 1440 },
     filterSettings: {
          blur: { isActive: false, value: '1.5px' },
          delay: { isActive: false, value: '0.5s' },
          clickDelay: { isActive: false, value: 1000 },
          scrollFriction: { isActive: false, value: 50 },
          desaturation: { isActive: false, value: '50%' },
          letterSpacing: { isActive: false, value: '0.1em' },
          textOpacity: { isActive: false, value: '0.9' },
          textBlur: { isActive: false, value: '0.3px' },
          lineHeight: { isActive: false, value: '1.45' },
          textShadow: { isActive: false, value: '0 1px 0 rgba(0,0,0,0.25)' },
          textShuffle: { isActive: false, value: 0.15 },
          mediaOpacity: { isActive: false, value: '0.9' },
          mediaBrightness: { isActive: false, value: '90%' },
          inputDelay: { isActive: false, value: 120 },
      } 
  }, (items) => {
    
    const url = window.location.href;
    const hostname = getHostname(url);
    const isBlocked = hostname && items.blockedUrls.includes(hostname);
    const isTimeActive = isFrictionTime(items.schedule);

      if (isBlocked && isTimeActive) {
          const filters = items.filterSettings;
          TextManager.update(filters);
          TextShuffleManager.update(filters.textShuffle);
          if (filters.delay?.isActive) DelayManager.apply(filters.delay.value);
          if (filters.inputDelay?.isActive) InputDelayManager.apply(filters.inputDelay.value);
          if (filters.clickDelay?.isActive) InteractionManager.applyClickDelay(filters.clickDelay.value);
          if (filters.scrollFriction?.isActive) InteractionManager.applyScroll(filters.scrollFriction.value);
          VisualManager.update(filters);
      }
  });
