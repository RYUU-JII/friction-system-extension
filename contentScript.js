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
// NOTE: Content scripts are not ES modules in MV3.
// Helpers are provided via `utils/contentUtils.js` (loaded before this file by `manifest.json`).

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
    VISUAL_TARGETS: ':is(img, picture, canvas, svg, [role="img"], [data-testid="tweetPhoto"] [style*="background-image"], [style*="background-image"]:not(:has(img, video, canvas, svg)), #thumbnail img, [id="thumbnail"] img, .thumbnail img, .thumb img, [class*="thumbnail"] img, [class*="thumb"] img, ytd-thumbnail img, ytd-rich-grid-media img, ytd-compact-video-renderer img, ytd-reel-video-renderer img)',
    VISUAL_VIDEO_TARGETS: ':is(video)',
    
    // INTERACTIVE_TARGETS는 네비게이션 및 인터랙션 요소를 포괄하도록 확장되었습니다.
    INTERACTIVE_TARGETS: ':is(a, button, article, [onclick], input[type="submit"], input[type="image"], [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="article"], [role="menuitem"], [role="option"], [role="tab"], [class*="link"], [class*="button"], [class*="btn"], figure):not(.stickyunit)',
    
    TEXT_LAYOUT_TARGETS: ':is(p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, a, span[role="text"])',
    TEXT_VISUAL_TARGETS: ':is(span:not([role]), span[role="text"], a:not(:has(img, video, canvas, svg)), p:not(:has(img, video, canvas, svg)), li:not(:has(img, video, canvas, svg)), h1:not(:has(img, video, canvas, svg)), h2:not(:has(img, video, canvas, svg)), h3:not(:has(img, video, canvas, svg)), h4:not(:has(img, video, canvas, svg)), h5:not(:has(img, video, canvas, svg)), h6:not(:has(img, video, canvas, svg)), blockquote:not(:has(img, video, canvas, svg)))',
    TEXT_TARGETS: ':is(p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, a, span[role="text"])'
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
    _videoContainers: new Set(),
    _videoHoverScopes: new Set(),
    _videoObserver: null,
    _trackVideoContainers: false,

    _clearVideoContainers() {
        for (const el of this._videoContainers) {
            try { el.removeAttribute('data-friction-video-container'); } catch (e) {}
        }
        this._videoContainers.clear();
        for (const el of this._videoHoverScopes) {
            try { el.removeAttribute('data-friction-video-hover-scope'); } catch (e) {}
        }
        this._videoHoverScopes.clear();
        if (this._videoObserver) {
            try { this._videoObserver.disconnect(); } catch (e) {}
            this._videoObserver = null;
        }
        this._trackVideoContainers = false;
    },

    _markVideoContainer(videoEl) {
        const parent = videoEl && videoEl.parentElement;
        if (!parent || parent === document.documentElement || parent === document.body) return;
        parent.setAttribute('data-friction-video-container', '1');
        this._videoContainers.add(parent);
    },

    _markVideoHoverScope(videoEl) {
        if (!videoEl || !(videoEl instanceof Element)) return;

        let videoRect = null;
        try {
            videoRect = videoEl.getBoundingClientRect();
        } catch (_) {
            // ignore
        }

        const mark = (el) => {
            if (!el || el === document.documentElement || el === document.body) return false;
            try { el.setAttribute('data-friction-video-hover-scope', '1'); } catch (e) { return false; }
            this._videoHoverScopes.add(el);
            return true;
        };

        const parent = videoEl.parentElement;
        if (!parent || parent === document.documentElement || parent === document.body) return;
        mark(parent);

        let current = parent.parentElement;
        let markedExtra = 0;
        while (current && markedExtra < 2 && current !== document.documentElement && current !== document.body) {
            if (!videoRect || !videoRect.width || !videoRect.height) break;

            let rect = null;
            try {
                rect = current.getBoundingClientRect();
            } catch (_) {
                break;
            }
            if (!rect || !rect.width || !rect.height) break;

            const videoArea = videoRect.width * videoRect.height;
            const currentArea = rect.width * rect.height;

            const areaOk = currentArea <= videoArea * 3;
            const widthOk = rect.width <= videoRect.width * 1.8;
            const heightOk = rect.height <= videoRect.height * 2.2;
            if (!areaOk || !widthOk || !heightOk) break;

            mark(current);
            markedExtra += 1;
            current = current.parentElement;
        }
    },

    _markVideoTracking(videoEl) {
        this._markVideoHoverScope(videoEl);
        if (this._trackVideoContainers) this._markVideoContainer(videoEl);
    },

    _ensureVideoContainerTracking({ trackContainers } = {}) {
        const nextTrackContainers = !!trackContainers;
        if (!nextTrackContainers && this._videoContainers.size > 0) {
            for (const el of this._videoContainers) {
                try { el.removeAttribute('data-friction-video-container'); } catch (e) {}
            }
            this._videoContainers.clear();
        }
        this._trackVideoContainers = nextTrackContainers;

        document.querySelectorAll('video').forEach((v) => this._markVideoTracking(v));

        if (this._videoObserver) return;
        this._videoObserver = new MutationObserver((mutations) => {
            for (const m of mutations) {
                for (const node of m.addedNodes || []) {
                    if (!(node instanceof Element)) continue;
                    if (node.tagName === 'VIDEO') {
                        this._markVideoTracking(node);
                        continue;
                    }
                    if (!node.querySelectorAll) continue;
                    node.querySelectorAll('video').forEach((v) => this._markVideoTracking(v));

                }
            }
        });
        try {
            this._videoObserver.observe(document.documentElement || document, { childList: true, subtree: true });
        } catch (e) {
            // ignore
        }
    },

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

        const baseFilterValues = [];
        if (blur && blur.isActive) baseFilterValues.push(`blur(${blur.value})`);
        if (desat && desat.isActive) baseFilterValues.push(`grayscale(${desat.value})`);

        const brightnessFilter = mediaBrightness && mediaBrightness.isActive ? `brightness(${mediaBrightness.value})` : '';
        const combinedFilterParts = baseFilterValues.concat(brightnessFilter ? [brightnessFilter] : []);
        const combinedFilter = combinedFilterParts.length > 0 ? combinedFilterParts.join(' ') : 'none';
        const videoLeafFilter = baseFilterValues.length > 0 ? baseFilterValues.join(' ') : 'none';
        
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

        const shouldTrackVideoHoverScopes = baseFilterValues.length > 0;
        const shouldTrackVideoContainers = !!(mediaBrightness && mediaBrightness.isActive) || !!(mediaOpacity && mediaOpacity.isActive);
        if (shouldTrackVideoHoverScopes || shouldTrackVideoContainers) {
            this._ensureVideoContainerTracking({ trackContainers: shouldTrackVideoContainers });
        }
        else this._clearVideoContainers();

        style.textContent = `
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_TARGETS} {
                filter: ${combinedFilter} !important;
                ${opacityRule}
                transition: filter 0.1s ease, opacity 0.1s ease;
                /* will-change: filter; 제거 */
            }
            html:not([${STYLES.VISUAL.ATTR}="none"]) [data-friction-video-hover-scope="1"]:hover ${SELECTORS.VISUAL_VIDEO_TARGETS} {
                filter: none !important;
            }
            html:not([${STYLES.VISUAL.ATTR}="none"]) [data-friction-video-hover-scope="1"]:has(:hover) ${SELECTORS.VISUAL_VIDEO_TARGETS} {
                filter: none !important;
            }
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_VIDEO_TARGETS} {
                filter: ${videoLeafFilter} !important;
                opacity: 1 !important;
                transition: filter 0.1s ease;
            }
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_VIDEO_TARGETS}:hover {
                filter: none !important;
            }
            html:not([${STYLES.VISUAL.ATTR}="none"]) [data-friction-video-container="1"] {
                filter: ${brightnessFilter ? brightnessFilter : 'none'} !important;
                ${opacityRule}
                transition: filter 0.1s ease, opacity 0.1s ease;
            }
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_TARGETS}:hover {
                filter: none !important;
                opacity: 1 !important;
            }
            html:not([${STYLES.VISUAL.ATTR}="none"]) [data-friction-video-container="1"]:hover {
                filter: none !important;
                opacity: 1 !important;
            }
            /* 이중 필터 버그 수정: 자식 요소가 호버되면 부모 필터도 해제 */
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_TARGETS}:has(:hover) {
                filter: none !important;
                opacity: 1 !important;
            }
            html:not([${STYLES.VISUAL.ATTR}="none"]) [data-friction-video-container="1"]:has(:hover) {
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
        this._clearVideoContainers();
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

        const hoverResetRules = (() => {
            const parts = [];
            if (opacityValue) parts.push('opacity: 1 !important;');
            if (blurValue) parts.push('filter: none !important;');
            if (shadowValue) parts.push('text-shadow: none !important;');
            if (parts.length === 0) return '';
            return `
                ${SELECTORS.TEXT_VISUAL_TARGETS}:hover,
                ${SELECTORS.TEXT_VISUAL_TARGETS}:has(:hover) {
                    ${parts.join('\n                    ')}
                }
            `;
        })();

        const visualTextRules = (opacityValue || blurValue || shadowValue)
            ? `
                ${SELECTORS.TEXT_VISUAL_TARGETS} {
                    ${opacityValue ? `opacity: ${opacityValue} !important;` : ''}
                    ${blurValue ? `filter: blur(${blurValue}) !important;` : ''}
                    ${shadowValue ? `text-shadow: ${shadowValue} !important;` : ''}
                    transition: opacity 0.15s ease, filter 0.15s ease, text-shadow 0.15s ease;
                }
                ${hoverResetRules}
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
    shuffledTextByNode: new WeakMap(),
    hoverActiveRoot: null,
    hoverActiveNodes: new Set(),
    boundPointerOver: null,
    boundPointerOut: null,
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
        this.enableHoverPreview();
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

    enableHoverPreview() {
        if (this.boundPointerOver || this.boundPointerOut) return;

        this.boundPointerOver = (e) => {
            if (!this.enabled) return;
            const target = e?.target;
            const targetEl =
                target instanceof Element ? target : (target && target.parentElement ? target.parentElement : null);
            const root = targetEl ? targetEl.closest('[data-friction-shuffled="1"]') : null;

            if (!root) {
                this._clearHoverPreview();
                return;
            }

            if (this.hoverActiveRoot === root) return;

            this._clearHoverPreview();
            this._applyHoverPreview(root);
        };

        this.boundPointerOut = (e) => {
            if (!this.hoverActiveRoot) return;

            const from = e?.target instanceof Node ? e.target : null;
            if (!from || !this.hoverActiveRoot.contains(from)) return;

            const to = e?.relatedTarget instanceof Node ? e.relatedTarget : null;
            if (to && this.hoverActiveRoot.contains(to)) return;

            this._clearHoverPreview();
        };

        document.addEventListener('pointerover', this.boundPointerOver, true);
        document.addEventListener('pointerout', this.boundPointerOut, true);
    },

    disableHoverPreview() {
        if (this.boundPointerOver) {
            document.removeEventListener('pointerover', this.boundPointerOver, true);
            this.boundPointerOver = null;
        }
        if (this.boundPointerOut) {
            document.removeEventListener('pointerout', this.boundPointerOut, true);
            this.boundPointerOut = null;
        }
        this._clearHoverPreview();
    },

    _applyHoverPreview(rootEl) {
        if (!rootEl || !(rootEl instanceof Element)) return;

        this.hoverActiveRoot = rootEl;
        this.hoverActiveNodes.clear();

        const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
        while (true) {
            const node = walker.nextNode();
            if (!node) break;
            const original = this.originalTextByNode.get(node);
            const shuffled = this.shuffledTextByNode.get(node);
            if (typeof original !== 'string' || typeof shuffled !== 'string') continue;
            node.nodeValue = original;
            this.hoverActiveNodes.add(node);
        }
    },

    _clearHoverPreview() {
        if (this.hoverActiveNodes.size > 0) {
            for (const node of Array.from(this.hoverActiveNodes)) {
                if (!node || !node.isConnected) continue;
                const shuffled = this.shuffledTextByNode.get(node);
                if (typeof shuffled === 'string') node.nodeValue = shuffled;
            }
        }
        this.hoverActiveNodes.clear();
        this.hoverActiveRoot = null;
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
        this._clearHoverPreview();
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
        this.shuffledTextByNode = new WeakMap();

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
// 3.5 Nudge Game (Blocked-site focus reminder)
// ===========================================================

const NudgeGame = (() => {
    const DEFAULT_CONFIG = {
        spriteSizePx: 96,
        baseSpeedPxPerSec: 140,
        spawnIntervalMs: 4000,
        maxSprites: 6,
        speedRamp: 1.15,
        asset: {
            gifPath: 'samples/images/nudge-object.gif',
            audioPath: 'samples/sounds/nudge-music.mp3',
            label: 'nudge-object',
        },
        message: {
            title: '잠깐!',
            body: '오늘 이 사이트에서 시간을 너무 많이 썼어. 잠깐 쉬고 갈래?',
        },
    };

    let config = DEFAULT_CONFIG;
    let mode = 'auto';
    let root = null;
    let shadow = null;
    let layer = null;
    let sprites = [];
    let rafId = null;
    let lastTs = null;
    let spawnTimer = null;
    let modalOpen = false;
    let audio = null;
    let audioFadeToken = 0;
    let pendingAudioUnlock = false;

    function clamp(n, min, max) {
        const x = Number(n);
        if (!Number.isFinite(x)) return min;
        return Math.max(min, Math.min(max, x));
    }

    function mergeConfig(partial) {
        const src = partial && typeof partial === 'object' ? partial : {};
        const merged = {
            ...DEFAULT_CONFIG,
            ...src,
            asset: {
                ...DEFAULT_CONFIG.asset,
                ...(src.asset && typeof src.asset === 'object' ? src.asset : {}),
            },
            message: {
                ...DEFAULT_CONFIG.message,
                ...(src.message && typeof src.message === 'object' ? src.message : {}),
            },
        };

        merged.spriteSizePx = clamp(merged.spriteSizePx, 32, 260);
        merged.baseSpeedPxPerSec = clamp(merged.baseSpeedPxPerSec, 20, 1200);
        merged.spawnIntervalMs = clamp(merged.spawnIntervalMs, 200, 30_000);
        merged.maxSprites = Math.round(clamp(merged.maxSprites, 1, 40));
        merged.speedRamp = clamp(merged.speedRamp, 1.0, 3.0);
        return merged;
    }

    function ensureRoot() {
        if (root && shadow && layer) return;
        root = document.createElement('div');
        root.id = 'friction-nudge-root';
        root.style.position = 'fixed';
        root.style.inset = '0';
        root.style.zIndex = '2147483647';
        root.style.pointerEvents = 'none';

        shadow = root.attachShadow({ mode: 'open' });
        shadow.innerHTML = `
            <style>
                :host { all: initial; }
                .layer { position: fixed; inset: 0; pointer-events: none; }
                .sprite {
                    position: fixed;
                    left: 0;
                    top: 0;
                    width: 96px;
                    height: 96px;
                    pointer-events: auto;
                    user-select: none;
                    -webkit-user-drag: none;
                    will-change: transform;
                    cursor: pointer;
                    filter: drop-shadow(0 10px 20px rgba(0,0,0,0.22));
                }
                .modal-backdrop {
                    position: fixed;
                    inset: 0;
                    background: rgba(15, 23, 42, 0.55);
                    backdrop-filter: blur(6px);
                    pointer-events: auto;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                .modal-backdrop.is-open { display: flex; }
                .modal {
                    width: min(520px, 92vw);
                    background: rgba(255,255,255,0.92);
                    color: #0f172a;
                    border: 1px solid rgba(226, 232, 240, 0.9);
                    border-radius: 18px;
                    box-shadow: 0 22px 55px rgba(0,0,0,0.25);
                    padding: 18px 18px 16px;
                    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Apple SD Gothic Neo, 'Noto Sans KR', sans-serif;
                }
                .modal h3 { margin: 0 0 6px; font-size: 18px; }
                .modal p { margin: 0 0 14px; color: rgba(15,23,42,0.72); line-height: 1.45; }
                .actions { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
                .btn {
                    border: 1px solid rgba(148, 163, 184, 0.35);
                    background: rgba(255,255,255,0.9);
                    color: #0f172a;
                    padding: 10px 14px;
                    border-radius: 12px;
                    font-weight: 700;
                    cursor: pointer;
                }
                .btn.primary {
                    background: #6366f1;
                    color: #fff;
                    border-color: transparent;
                }
                .btn:focus-visible { outline: 3px solid rgba(99, 102, 241, 0.35); outline-offset: 2px; }
            </style>
            <div class="layer"></div>
            <div class="modal-backdrop" id="nudgeModalBackdrop" role="dialog" aria-modal="true" aria-label="집중 환기">
                <div class="modal">
                    <h3 id="nudgeTitle"></h3>
                    <p id="nudgeBody"></p>
                    <div class="actions">
                        <button class="btn" id="nudgeContinueBtn" type="button">계속하기</button>
                        <button class="btn primary" id="nudgeLeaveBtn" type="button">대시보드로 이동</button>
                    </div>
                </div>
            </div>
            <audio id="nudgeBgm" preload="auto" loop></audio>
        `;

        layer = shadow.querySelector('.layer');
        audio = shadow.getElementById('nudgeBgm');

        const backdrop = shadow.getElementById('nudgeModalBackdrop');
        const btnContinue = shadow.getElementById('nudgeContinueBtn');
        const btnLeave = shadow.getElementById('nudgeLeaveBtn');

        btnContinue?.addEventListener('click', () => {
            ackAndStop();
        });
        btnLeave?.addEventListener('click', () => {
            navigateToDashboard();
        });
        backdrop?.addEventListener('click', (e) => {
            if (e.target === backdrop) {
                ackAndStop();
            }
        });

        document.documentElement.appendChild(root);
    }

    function setModalOpen(isOpen) {
        modalOpen = isOpen;
        const backdrop = shadow?.getElementById('nudgeModalBackdrop');
        if (backdrop) backdrop.classList.toggle('is-open', !!isOpen);
        if (isOpen) {
            shadow?.getElementById('nudgeLeaveBtn')?.focus?.();
        }
    }

    function setModalText(title, body) {
        const t = shadow?.getElementById('nudgeTitle');
        const b = shadow?.getElementById('nudgeBody');
        if (t) t.textContent = title || DEFAULT_CONFIG.message.title;
        if (b) b.textContent = body || DEFAULT_CONFIG.message.body;
    }

    function applyAudioSource() {
        if (!audio) return;
        const src = config?.asset?.audioPath ? chrome.runtime.getURL(config.asset.audioPath) : '';
        if (!src) return;
        if (audio.getAttribute('src') !== src) {
            audio.pause();
            audio.currentTime = 0;
            audio.setAttribute('src', src);
            audio.load();
        }
        audio.volume = 0;
    }

    function fadeAudioTo(targetVolume, { pauseAtEnd = false } = {}) {
        const a = audio;
        if (!a) return;
        const token = ++audioFadeToken;
        const from = clamp(a.volume, 0, 1);
        const to = clamp(targetVolume, 0, 1);
        const duration = 180;
        const start = performance.now();

        if (to > 0 && a.paused) {
            a.play().then(() => {
                pendingAudioUnlock = false;
            }).catch(() => {
                pendingAudioUnlock = true;
            });
        }

        function step(now) {
            if (token !== audioFadeToken) return;
            const t = Math.min(1, (now - start) / duration);
            const next = clamp(from + (to - from) * t, 0, 1);
            a.volume = next;
            if (t < 1) requestAnimationFrame(step);
            else if (pauseAtEnd && to === 0) a.pause();
        }

        requestAnimationFrame(step);
    }

    function randomVelocity(speed) {
        const angle = Math.random() * Math.PI * 2;
        return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
    }

    function updateSpriteSize(sprite) {
        const size = `${config.spriteSizePx}px`;
        sprite.el.style.width = size;
        sprite.el.style.height = size;
    }

    function spawnOne() {
        ensureRoot();
        if (!layer) return;
        if (sprites.length >= config.maxSprites) return;

        const el = document.createElement('img');
        el.className = 'sprite';
        el.alt = config?.asset?.label || 'nudge';
        el.dataset.frictionFallbackStep = '0';
        el.src = chrome.runtime.getURL(config.asset.gifPath);
        el.addEventListener('error', () => {
            const step = parseInt(el.dataset.frictionFallbackStep || '0', 10) || 0;
            if (step === 0 && config.asset.gifPath !== 'samples/images/nudge-object.gif') {
                el.dataset.frictionFallbackStep = '1';
                el.src = chrome.runtime.getURL('samples/images/nudge-object.gif');
                return;
            }
            if (step <= 1) {
                el.dataset.frictionFallbackStep = '2';
                el.src = chrome.runtime.getURL('samples/images/rat-dance.gif');
            }
        });
        el.decoding = 'async';
        updateSpriteSize({ el });

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const size = config.spriteSizePx;

        const x = Math.random() * Math.max(1, vw - size);
        const y = Math.random() * Math.max(1, vh - size);

        const speed = config.baseSpeedPxPerSec * (sprites.length === 0 ? 1 : Math.pow(config.speedRamp, sprites.length * 0.5));
        const vel = randomVelocity(speed);

        const sprite = { el, x, y, vx: vel.vx, vy: vel.vy };

        el.addEventListener('click', () => {
            setModalText(config.message.title, config.message.body);
            setModalOpen(true);
            if (pendingAudioUnlock) fadeAudioTo(0.85);
        });

        layer.appendChild(el);
        sprites.push(sprite);
        el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
    }

    function speedUpAll() {
        for (const s of sprites) {
            s.vx *= config.speedRamp;
            s.vy *= config.speedRamp;
        }
    }

    function startSpawner() {
        if (spawnTimer) clearInterval(spawnTimer);
        spawnTimer = setInterval(() => {
            if (modalOpen) return;
            if (sprites.length < config.maxSprites) {
                spawnOne();
                speedUpAll();
            }
        }, config.spawnIntervalMs);
    }

    function stopSpawner() {
        if (!spawnTimer) return;
        clearInterval(spawnTimer);
        spawnTimer = null;
    }

    function loop(ts) {
        if (!root) return;
        if (lastTs === null) lastTs = ts;
        const dt = Math.min(0.05, (ts - lastTs) / 1000);
        lastTs = ts;

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const size = config.spriteSizePx;

        for (const s of sprites) {
            s.x += s.vx * dt;
            s.y += s.vy * dt;

            if (s.x <= 0) { s.x = 0; s.vx = Math.abs(s.vx); }
            if (s.y <= 0) { s.y = 0; s.vy = Math.abs(s.vy); }
            if (s.x >= vw - size) { s.x = vw - size; s.vx = -Math.abs(s.vx); }
            if (s.y >= vh - size) { s.y = vh - size; s.vy = -Math.abs(s.vy); }

            s.el.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0)`;
        }

        rafId = requestAnimationFrame(loop);
    }

    function startLoop() {
        if (rafId) cancelAnimationFrame(rafId);
        lastTs = null;
        rafId = requestAnimationFrame(loop);
    }

    function stopLoop() {
        if (!rafId) return;
        cancelAnimationFrame(rafId);
        rafId = null;
        lastTs = null;
    }

    function ackAndStop() {
        stop();
    }

    function navigateToDashboard() {
        stop();
        try {
            window.location.href = chrome.runtime.getURL('dashboard.html');
        } catch (e) {}
    }

    function start(nextConfig) {
        config = mergeConfig(nextConfig);
        mode = (nextConfig && typeof nextConfig === 'object' && nextConfig.__mode === 'debug') ? 'debug' : 'auto';
        ensureRoot();
        applyAudioSource();
        setModalOpen(false);

        if (sprites.length === 0) spawnOne();
        startSpawner();
        startLoop();

        fadeAudioTo(0.65);
    }

    function stop() {
        stopSpawner();
        stopLoop();
        sprites.forEach((s) => s.el.remove());
        sprites = [];
        if (audio) fadeAudioTo(0, { pauseAtEnd: true });
        if (root) root.remove();
        root = null;
        shadow = null;
        layer = null;
        audio = null;
        modalOpen = false;
        pendingAudioUnlock = false;
        mode = 'auto';
    }

    function setConfig(partial) {
        config = mergeConfig({ ...config, ...(partial && typeof partial === 'object' ? partial : {}) });
        for (const s of sprites) updateSpriteSize(s);
        startSpawner();
    }

    function spawn() {
        spawnOne();
    }

    function isActive() {
        return !!root;
    }

    function getMode() {
        return mode;
    }

    return { start, stop, setConfig, spawn, isActive, getMode };
})();

// ===========================================================
// 4. Main Controller
// ===========================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request && typeof request.type === 'string') {
          try {
              if (request.type === 'NUDGE_START') {
                  const cfg = request.payload?.config || {};
                  NudgeGame.start({ ...cfg, __mode: request.payload?.reason === 'debug' ? 'debug' : 'auto' });
              } else if (request.type === 'NUDGE_STOP') {
                  NudgeGame.stop();
              } else if (request.type === 'NUDGE_DEBUG_START') {
                  const cfg = request.payload?.config || {};
                  NudgeGame.start({ ...cfg, __mode: 'debug' });
              } else if (request.type === 'NUDGE_DEBUG_CONFIG') {
                  NudgeGame.setConfig(request.payload?.config);
              } else if (request.type === 'NUDGE_DEBUG_SPAWN') {
                  const cfg = request.payload?.config || {};
                  if (!NudgeGame.isActive()) NudgeGame.start({ ...cfg, __mode: 'debug' });
                  else if (request.payload?.config) NudgeGame.setConfig(request.payload?.config);
                  NudgeGame.spawn();
              }
              sendResponse?.({ ok: true });
          } catch (e) {
              sendResponse?.({ ok: false, error: String(e?.message || e) });
          }
          return false;
      }

      if (typeof request?.isBlocked === 'boolean' && !request.isBlocked) {
          VisualManager.remove();
          DelayManager.remove();
          TextManager.remove();
          TextShuffleManager.disable();
          InputDelayManager.remove();
          InteractionManager.removeClickDelay();
          InteractionManager.removeScroll();
          if (NudgeGame.isActive() && NudgeGame.getMode() !== 'debug') {
              NudgeGame.stop();
          }
          sendResponse?.({ ok: true });
          return false;
      }

    if (!request || !request.filters) return;
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
      sendResponse?.({ ok: true });
      return false;
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
