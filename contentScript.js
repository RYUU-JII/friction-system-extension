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
    TEXT_SHUFFLE: { ID: 'friction-text-shuffle-style', ATTR: 'data-text-shuffle-pending' },
    INPUT_DELAY: { ID: 'friction-input-delay-style', ATTR: 'data-input-delay-applied' },
};

let anxietyBuffer = {
    clicks: 0,
    scrollSpikes: 0,
    dragCount: 0,
    backspaces: 0,
    backHistory: 0,
    videoSkips: 0
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
    // NOTE: Twitter/X's image cards often include BOTH a background-image layer and a nested <img>.
    // Filtering both creates a "double layer" where hover reset only affects one, so the image looks like it didn't unfilter.
    // Prefer the background-image layer under [data-testid="tweetPhoto"] and exclude the nested <img> from VISUAL_TARGETS.
    VISUAL_TARGETS: ':is(img:not([data-testid="tweetPhoto"] img), picture, canvas, svg, [role="img"], [data-testid="tweetPhoto"] [style*="background-image"], [style*="background-image"]:not(:has(img, video, canvas, svg)), #thumbnail img, [id="thumbnail"] img, .thumbnail img, .thumb img, [class*="thumbnail"] img, [class*="thumb"] img, ytd-thumbnail img, ytd-rich-grid-media img, ytd-compact-video-renderer img, ytd-reel-video-renderer img)',
    VISUAL_VIDEO_TARGETS: ':is(video)',
    
    // INTERACTIVE_TARGETS는 네비게이션 및 인터랙션 요소를 포괄하도록 확장되었습니다.
    INTERACTIVE_TARGETS: ':is(a, button, article, [onclick], input[type="submit"], input[type="image"], [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="article"], [role="menuitem"], [role="option"], [role="tab"], [class*="link"], [class*="button"], [class*="btn"], figure):not(.stickyunit)',
    
    TEXT_LAYOUT_TARGETS: ':is(p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, a, span[role="text"])',
    TEXT_VISUAL_TARGETS: ':is(span:not([role]), span[role="text"], a:not(:has(img, video, canvas, svg)), p:not(:has(img, video, canvas, svg)), li:not(:has(img, video, canvas, svg)), h1:not(:has(img, video, canvas, svg)), h2:not(:has(img, video, canvas, svg)), h3:not(:has(img, video, canvas, svg)), h4:not(:has(img, video, canvas, svg)), h5:not(:has(img, video, canvas, svg)), h6:not(:has(img, video, canvas, svg)), blockquote:not(:has(img, video, canvas, svg)))',
    TEXT_TARGETS: ':is(p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, a, span[role="text"])',
    
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
    _videoHoverScopes: new Set(),
    _videoObserver: null,
    _trackVideoHoverScopes: false,

    _clearVideoContainers() {
        for (const el of this._videoHoverScopes) {
            try { el.removeAttribute('data-friction-video-hover-scope'); } catch (e) {}
        }
        this._videoHoverScopes.clear();
        if (this._videoObserver) {
            try { this._videoObserver.disconnect(); } catch (e) {}
            this._videoObserver = null;
        }
        this._trackVideoHoverScopes = false;
    },

    _markVideoHoverScope(videoEl) {
        if (!videoEl || !(videoEl instanceof Element)) return;

        const mark = (el) => {
            if (!el || el === document.documentElement || el === document.body) return false;
            try { el.setAttribute('data-friction-video-hover-scope', '1'); } catch (_) { return false; }
            this._videoHoverScopes.add(el);
            return true;
        };

        // Mark a small chain so that hovering video overlays/controls still reveals the video.
        let current = videoEl.parentElement;
        let steps = 0;
        while (current && steps < 3 && current !== document.documentElement && current !== document.body) {
            mark(current);
            steps += 1;
            current = current.parentElement;
        }
    },

    _markVideoTracking(videoEl) {
        if (this._trackVideoHoverScopes) this._markVideoHoverScope(videoEl);
    },

    _ensureVideoContainerTracking({ trackHoverScopes } = {}) {
        const nextTrackHoverScopes = !!trackHoverScopes;
        if (!nextTrackHoverScopes && this._videoHoverScopes.size > 0) {
            for (const el of this._videoHoverScopes) {
                try { el.removeAttribute('data-friction-video-hover-scope'); } catch (e) {}
            }
            this._videoHoverScopes.clear();
        }
        this._trackVideoHoverScopes = nextTrackHoverScopes;

        if (!this._trackVideoHoverScopes) {
            this._clearVideoContainers();
            return;
        }

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
        const hoverRevealSetting = filters.hoverReveal;
        const hoverRevealEnabled = hoverRevealSetting ? !!hoverRevealSetting.isActive : true;

        const isActive =
            (blur && blur.isActive) ||
            (desat && desat.isActive);

        if (!isActive) {
            this.remove();
            return;
        }

        const baseFilterValues = [];
        const baseNeutralFilterValues = [];
        if (blur && blur.isActive) {
            baseFilterValues.push(`blur(${blur.value})`);
            baseNeutralFilterValues.push('blur(0px)');
        }
        if (desat && desat.isActive) {
            baseFilterValues.push(`grayscale(${desat.value})`);
            baseNeutralFilterValues.push('grayscale(0%)');
        }

        const combinedFilterParts = baseFilterValues;
        const combinedFilter = combinedFilterParts.length > 0 ? combinedFilterParts.join(' ') : 'none';
        const videoLeafFilter = baseFilterValues.length > 0 ? baseFilterValues.join(' ') : 'none';

        const combinedNeutralFilterParts = baseNeutralFilterValues;
        const combinedNeutralFilter = combinedNeutralFilterParts.length > 0 ? combinedNeutralFilterParts.join(' ') : 'none';
        const videoLeafNeutralFilter = baseNeutralFilterValues.length > 0 ? baseNeutralFilterValues.join(' ') : 'none';
        
        let style = document.getElementById(STYLES.VISUAL.ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLES.VISUAL.ID;
            document.head.appendChild(style);
        }

        // ✨ 핵심 수정: html 태그의 속성을 확인하고, will-change를 제거했습니다.
        // ✨ 핵심 추가: :has(:hover)를 통해 이중 필터링을 방지합니다.
        const overlayExempt = ':is([role="dialog"], [aria-modal="true"])';

        const shouldTrackVideoHoverScopes = hoverRevealEnabled && baseFilterValues.length > 0;
        if (shouldTrackVideoHoverScopes) this._ensureVideoContainerTracking({ trackHoverScopes: true });
        else this._clearVideoContainers();

        const visualTargetFilterRule = combinedFilterParts.length > 0 ? `filter: ${combinedFilter} !important;` : '';
        const videoTargetFilterRule = baseFilterValues.length > 0 ? `filter: ${videoLeafFilter} !important;` : '';
        const hoverVisualFilterResetRule =
            combinedFilterParts.length > 0 ? `filter: ${combinedNeutralFilter} !important;` : '';
        const hoverVideoFilterResetRule = baseFilterValues.length > 0 ? `filter: ${videoLeafNeutralFilter} !important;` : '';

        HoverRevealManager.update({ enabled: hoverRevealEnabled && combinedFilterParts.length > 0 });

        style.textContent = `
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_TARGETS} {
                ${visualTargetFilterRule}
                transition: filter 0.15s ease;
                /* will-change: filter; 제거 */
            }
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_VIDEO_TARGETS} {
                ${videoTargetFilterRule}
                transition: filter 0.15s ease;
            }

            /*
             * Reveal reset rules:
             * - Keep a generic [data-friction-reveal] reset for containers.
             * - Also target the actual VISUAL_TARGETS with the attribute to match the same specificity as the base :is(...)
             *   (important because :is() takes the MAX specificity of its list).
             */
            html:not([${STYLES.VISUAL.ATTR}="none"]) [data-friction-reveal="1"] {
                ${hoverVisualFilterResetRule}
            }
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_TARGETS}[data-friction-reveal="1"],
            html:not([${STYLES.VISUAL.ATTR}="none"]) [data-friction-reveal="1"] ${SELECTORS.VISUAL_TARGETS} {
                ${hoverVisualFilterResetRule}
            }
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_VIDEO_TARGETS}[data-friction-reveal="1"],
            html:not([${STYLES.VISUAL.ATTR}="none"]) [data-friction-reveal="1"] ${SELECTORS.VISUAL_VIDEO_TARGETS} {
                ${hoverVideoFilterResetRule}
            }



            /* 이중 필터 버그 수정: 자식 요소가 호버되면 부모 필터도 해제 */



            /* 오버레이/모달은 시각 필터에서 제외: X 사진 팝업이 "열리지만 안 보이는" 현상 방지 */
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${overlayExempt} ${SELECTORS.VISUAL_TARGETS},
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${overlayExempt} ${SELECTORS.VISUAL_VIDEO_TARGETS},
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${overlayExempt} {
                filter: none !important;
            }
        `;
        setRootAttribute(STYLES.VISUAL.ATTR, 'active');
    },

    remove() {
        const style = document.getElementById(STYLES.VISUAL.ID);
        if (style) style.remove();
        setRootAttribute(STYLES.VISUAL.ATTR, 'none');
        this._clearVideoContainers();
        HoverRevealManager.update({ enabled: false });
    }
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

            // Cross shadow root boundary (open shadow roots).
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

        const pickFirstMatching = (selector) => {
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

        // Prefer "real" media over icons/overlays.
        return (
            pickFirstMatching(SELECTORS.VISUAL_VIDEO_TARGETS) ||
            pickFirstMatching(':is(img, picture, canvas)') ||
            pickFirstMatching(':is([style*="background-image"])') ||
            pickFirstMatching(':is(svg, [role="img"])') ||
            pickFirstMatching(SELECTORS.VISUAL_TARGETS)
        );
    },

    _getSitePreferredScope(el) {
        if (!(el instanceof Element)) return null;

        const host = String(window.location?.hostname || '').toLowerCase();
        const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com');
        if (isYouTube) {
            // YouTube hover previews often swap thumbnail -> video by inserting a <video> into the same "card" renderer.
            // Prefer a stable renderer container so reveal stays active across the swap (prevents a brief filtered video flash).
            return this._closestCrossShadow(
                el,
                [
                    'ytd-rich-grid-media',
                    'ytd-rich-item-renderer',
                    'ytd-video-renderer',
                    'ytd-grid-video-renderer',
                    'ytd-compact-video-renderer',
                    'ytd-playlist-video-renderer',
                    'ytd-reel-video-renderer',
                    'ytd-reel-item-renderer',
                    'ytd-thumbnail',
                    '#thumbnail',
                    '[id="thumbnail"]',
                ].join(', ')
            );
        }

        return null;
    },

    _getRevealScope(target, clientX, clientY) {
        // 1) Find the actual visual element under the pointer (works even when an overlay sibling intercepts events).
        const visualAtPoint = this._getBestVisualTargetAtPoint(clientX, clientY);
        if (visualAtPoint) {
            return (
                this._getSitePreferredScope(visualAtPoint) ||
                this._closestCrossShadow(visualAtPoint, '[data-testid="tweetPhoto"]') ||
                this._closestCrossShadow(visualAtPoint, '[data-friction-video-hover-scope="1"]') ||
                visualAtPoint
            );
        }

        // 2) Fallback: event target chain (works when the visual element itself receives events).
        if (target instanceof Element) {
            return (
                this._getSitePreferredScope(target) ||
                this._closestCrossShadow(target, '[data-testid="tweetPhoto"]') ||
                this._closestCrossShadow(target, '[data-friction-video-hover-scope="1"]') ||
                this._closestCrossShadow(target, 'img, picture, canvas, svg, video, [role="img"], [style*="background-image"]')
            );
        }

        return null;
    },

    _cancelPendingClear() {
        if (!this.pendingClearTimer) return;
        try { clearTimeout(this.pendingClearTimer); } catch (_) {}
        this.pendingClearTimer = null;
    },

    _scheduleDeferredClear(delayMs = 80) {
        if (!this.enabled) return;
        if (!this.currentScope) return;

        this._cancelPendingClear();
        this.pendingClearTimer = setTimeout(() => {
            this.pendingClearTimer = null;
            if (!this.enabled) return;

            // Re-evaluate based on current pointer position after UI transitions settle.
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

        // If the current scope got detached (virtualized lists, route changes), clear it.
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
            try { scopeAtPoint.setAttribute('data-friction-reveal', '1'); } catch (_) {}
            return;
        }

        const same =
            scopeAtPoint === this.currentScope ||
            this.currentScope.contains(scopeAtPoint) ||
            scopeAtPoint.contains(this.currentScope);

        if (same) return;

        // Pointer is now over a different visual target (scroll without pointermove, layout shift, etc).
        this.clear();
        this.currentScope = scopeAtPoint;
        this._sweepRevealMarks(this.currentScope);
        try { scopeAtPoint.setAttribute('data-friction-reveal', '1'); } catch (_) {}
    },

    _sweepRevealMarks(keepEl) {
        // Ensure we never leave multiple reveal marks behind; only keep the current scope marked.
        const now = Date.now();
        if (now - this._lastRevealSweepAt < 200) return; // throttle
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
            try { el.removeAttribute('data-friction-reveal'); } catch (_) {}
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
            try { scope.setAttribute('data-friction-reveal', '1'); } catch (_) {}
        };

        this.boundPointerOut = (e) => {
            if (!this.enabled) return;
            if (!this.currentScope) return;

            const clientX = Number.isFinite(e?.clientX) ? e.clientX : this.lastClientX;
            const clientY = Number.isFinite(e?.clientY) ? e.clientY : this.lastClientY;
            this.lastClientX = clientX;
            this.lastClientY = clientY;

            // If an overlay intercepts events, pointerout can fire even while still "visually" over the same media.
            const scopeAtPoint = this._getRevealScope(null, clientX, clientY);
            if (
                scopeAtPoint &&
                (scopeAtPoint === this.currentScope ||
                    this.currentScope.contains(scopeAtPoint) ||
                    scopeAtPoint.contains(this.currentScope))
            ) {
                return;
            }

            // Fallback only when pointer coordinates are unavailable.
            if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) {
                const related = e?.relatedTarget;
                if (related instanceof Node && this.currentScope.contains(related)) return;
            }

            // During UI transitions (YouTube thumbnail -> preview video), pointerout can fire transiently.
            // Keep the reveal mark briefly and re-check after the DOM settles to prevent flicker.
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
            try { cancelAnimationFrame(this.rafId); } catch (_) {}
            this.rafId = null;
        }
        this._cancelPendingClear();
        this.clear();
    },

    clear() {
        if (!this.currentScope) return;
        try { this.currentScope.removeAttribute('data-friction-reveal'); } catch (_) {}
        this.currentScope = null;
        this._sweepRevealMarks(null);
    },
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
        const textBlur = filters.textBlur;
        const textShadow = filters.textShadow;
        const textOpacity = filters.textOpacity;

        const isActive =
            (spacing && spacing.isActive) ||
            (textBlur && textBlur.isActive) ||
            (textShadow && textShadow.isActive) ||
            (textOpacity && textOpacity.isActive);

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
        const blurValue = textBlur && textBlur.isActive ? textBlur.value : null;
        const shadowValue = textShadow && textShadow.isActive ? textShadow.value : null;
        const rawOpacity = textOpacity && textOpacity.isActive ? parseFloat(String(textOpacity.value)) : null;
        const opacityValue = Number.isFinite(rawOpacity) ? Math.max(0, Math.min(1, rawOpacity)) : null;

        const hoverResetRules = (() => {
            const parts = [];
            if (blurValue) parts.push('filter: blur(0px) !important;');
            if (shadowValue) parts.push('text-shadow: none !important;');
            if (opacityValue !== null) parts.push('opacity: 1 !important;');
            if (parts.length === 0) return '';
            return `
                html[data-friction-hover-reveal="1"] ${SELECTORS.TEXT_VISUAL_TARGETS}:hover,
                html[data-friction-hover-reveal="1"] ${SELECTORS.TEXT_VISUAL_TARGETS}:has(:hover) {
                    ${parts.join('\n                    ')}
                }
            `;
        })();

        const visualTextRules = (blurValue || shadowValue || opacityValue !== null)
            ? `
                ${SELECTORS.TEXT_VISUAL_TARGETS} {
                    ${blurValue ? `filter: blur(${blurValue}) !important;` : ''}
                    ${shadowValue ? `text-shadow: ${shadowValue} !important;` : ''}
                    ${opacityValue !== null ? `opacity: ${opacityValue} !important;` : ''}
                    transition: filter 0.15s ease, text-shadow 0.15s ease, opacity 0.15s ease;
                }
                ${hoverResetRules}
            `
            : '';

        style.textContent = `
            ${SELECTORS.TEXT_LAYOUT_TARGETS} {
                letter-spacing: ${spacingValue} !important;
                transition: letter-spacing 0.3s ease;
            }
            ${visualTextRules}

            /* 오버레이/모달은 텍스트 시각 필터에서도 제외 */
            ${overlayExempt},
            ${overlayExempt} * {
                filter: none !important;
                text-shadow: none !important;
                opacity: 1 !important;
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
    hoverPreviewEnabled: true,
    boundPointerOver: null,
    boundPointerOut: null,
    observer: null,
    debounceTimer: null,
    pendingSubtrees: new Set(),
    pendingTextNodes: new Set(),
    initialPassDone: false,

    update(setting, options = {}) {
        const enabled = !!setting?.isActive;
        const strength = typeof setting?.value === 'number' ? setting.value : Number(setting?.value);
        const normalizedStrength = Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0;
        const hoverRevealEnabled = options.hoverRevealEnabled !== undefined ? !!options.hoverRevealEnabled : true;

        if (!enabled || normalizedStrength <= 0) {
            this.disable();
            return;
        }

        this.enabled = true;
        this.strength = normalizedStrength;
        this.maybeShieldInitialPaint();
        this.applyAll();
        this.setHoverPreviewEnabled(hoverRevealEnabled);
        this.ensureObserver();
        this.initialPassDone = true;
    },

    disable() {
        if (!this.enabled && this.touchedNodes.size === 0 && this.touchedElements.size === 0) return;
        this.enabled = false;
        this.strength = 0;
        this.hoverPreviewEnabled = false;
        this.pendingSubtrees.clear();
        this.pendingTextNodes.clear();
        this.teardownObserver();
        this.removeInitialPaintShield();
        this.disableHoverPreview();
        this.restoreAll();
    },

    setHoverPreviewEnabled(enabled) {
        const nextEnabled = !!enabled;
        if (this.hoverPreviewEnabled === nextEnabled) return;
        this.hoverPreviewEnabled = nextEnabled;
        if (nextEnabled && this.enabled) this.enableHoverPreview();
        else this.disableHoverPreview();
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

        this.installStyle();

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

        const style = document.getElementById(STYLES.INPUT_DELAY.ID);
        if (style) style.remove();
        setRootAttribute(STYLES.INPUT_DELAY.ATTR, 'none');

        this.maxDelayMs = 0;
        this.active = false;
    },

    isTextInput(el) {
        if (!el) return false;
        if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
        if (!(el instanceof HTMLInputElement)) return false;
        const disallowedTypes = new Set(['checkbox', 'radio', 'range', 'color', 'file', 'submit', 'button', 'image', 'reset', 'hidden', 'password']);
        if (disallowedTypes.has(el.type)) return false;
        return !el.readOnly && !el.disabled;
    },

    installStyle() {
        let style = document.getElementById(STYLES.INPUT_DELAY.ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLES.INPUT_DELAY.ID;
            const mount = document.head || document.documentElement;
            if (mount) mount.appendChild(style);
        }

        style.textContent = `
            html:not([${STYLES.INPUT_DELAY.ATTR}="none"]) [data-friction-input-delay="1"] {
                color: transparent !important;
                -webkit-text-fill-color: transparent !important;
                text-shadow: none !important;
                caret-color: var(--friction-caret-color, auto) !important;
            }
            html:not([${STYLES.INPUT_DELAY.ATTR}="none"]) [data-friction-input-delay="1"]::placeholder {
                color: var(--friction-placeholder-color, rgba(0,0,0,0.45)) !important;
                -webkit-text-fill-color: var(--friction-placeholder-color, rgba(0,0,0,0.45)) !important;
            }
            .friction-input-overlay {
                position: fixed;
                pointer-events: none;
                z-index: 2147483647;
                overflow: hidden;
                background: transparent;
                margin: 0;
                box-sizing: border-box;
            }
             .friction-input-overlay__inner {
                 box-sizing: border-box;
                 width: 100%;
                 height: 100%;
                 display: flex;
                 align-items: flex-start;
                 justify-content: flex-start;
             }
             .friction-input-overlay__content {
                 box-sizing: border-box;
                 min-width: 100%;
                 overflow-wrap: break-word;
                 word-break: break-word;
                 transform: translate3d(0, 0, 0);
                 will-change: transform;
             }
         `;

        setRootAttribute(STYLES.INPUT_DELAY.ATTR, 'active');
    },

    pickDelayMs() {
        const max = Math.max(0, this.maxDelayMs || 0);
        if (max <= 0) return 0;

        // Slider (0..500) acts as "annoyance strength": higher -> fewer no-delay keystrokes + occasional spikes.
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
         const el = state?.el;
         const overlay = state?.overlay;
         const inner = state?.inner;
         const content = state?.content;
         if (!el || !overlay || !inner || !content) return;
        if (!el.isConnected) {
            this.cleanupElement(el);
            return;
        }

        let rect;
        try {
            rect = el.getBoundingClientRect();
        } catch (_) {
            return;
        }
        if (!rect) return;

        overlay.style.left = `${rect.left}px`;
        overlay.style.top = `${rect.top}px`;
        overlay.style.width = `${rect.width}px`;
         overlay.style.height = `${rect.height}px`;
 
         const snap = state.snapshot || {};
         if (snap.padding) inner.style.padding = snap.padding;
         if (snap.font) content.style.font = snap.font;
         if (snap.letterSpacing) content.style.letterSpacing = snap.letterSpacing;
         if (snap.textAlign) content.style.textAlign = snap.textAlign;
         if (snap.lineHeight) content.style.lineHeight = snap.lineHeight;
         if (snap.color) content.style.color = snap.color;
         if (snap.textIndent) content.style.textIndent = snap.textIndent;
         if (snap.direction) content.style.direction = snap.direction;

        // Some UAs center/offset input text relative to the outer border box (especially for search fields).
        // Replicating border box metrics prevents subtle vertical "one notch" drift between the real input and the overlay text.
        if (snap.borderTopWidth || snap.borderRightWidth || snap.borderBottomWidth || snap.borderLeftWidth) {
            overlay.style.borderStyle = 'solid';
            overlay.style.borderColor = 'transparent';
            if (snap.borderTopWidth) overlay.style.borderTopWidth = snap.borderTopWidth;
            if (snap.borderRightWidth) overlay.style.borderRightWidth = snap.borderRightWidth;
            if (snap.borderBottomWidth) overlay.style.borderBottomWidth = snap.borderBottomWidth;
            if (snap.borderLeftWidth) overlay.style.borderLeftWidth = snap.borderLeftWidth;
        } else {
            overlay.style.borderWidth = '0';
            overlay.style.borderStyle = 'solid';
            overlay.style.borderColor = 'transparent';
        }
         if (snap.borderRadius) overlay.style.borderRadius = snap.borderRadius;
 
         const isTextarea = el instanceof HTMLTextAreaElement;
         inner.style.alignItems = isTextarea ? 'flex-start' : 'center';
         content.style.whiteSpace = isTextarea ? 'pre-wrap' : 'pre';
 
         const scrollLeft = el.scrollLeft || 0;
         const scrollTop = el.scrollTop || 0;
         content.style.transform = `translate3d(${-scrollLeft}px, ${-scrollTop}px, 0)`;
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
            // Prevent unbounded growth on fast typing: keep the most recent tail.
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
        // Keep overlay installed; just refresh position once (layout may change on blur).
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

        // Page/container scroll: keep overlays glued to their inputs.
        this.scheduleAllOverlaysUpdate();
    },
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
        // 1. 기본 브라우저 스크롤 및 전파 차단 (Friction 핵심)
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        // 2. 스크롤 값 누적
        state.scrollAccumulator.x += e.deltaX;
        state.scrollAccumulator.y += e.deltaY;

        // ⚡ [통합된 불안 감지 로직]
        // 휠을 한 번 굴릴 때의 강도(deltaY)가 크거나, 
        // 누적된 값이 짧은 시간 내에 매우 크다면 'scrollSpikes'로 간주
        const wheelIntensity = Math.abs(e.deltaY);
        if (wheelIntensity > 200) { // 강한 휠 조작 감지 (수치는 조정 가능)
            safeSendMessage({ type: "TRACK_ANXIETY", metric: "scrollSpikes" });
        }

        // 3. 지연 타이머 설정 (Friction 적용)
        if (state.scrollTimer) clearTimeout(state.scrollTimer);

        state.scrollTimer = setTimeout(() => {
            // 실제 화면 이동 실행
            window.scrollBy({
                left: state.scrollAccumulator.x,
                top: state.scrollAccumulator.y,
                behavior: 'instant' 
            });
            
            // 누적값 초기화
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
// 3.4 Anxiety Sensor
// ===========================================================
function safeSendMessage(message) {
    // 컨텍스트가 깨졌는지(Invalidated) 먼저 확인
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.id) {
        return; // 에러를 내지 않고 조용히 종료
    }

    try {
        chrome.runtime.sendMessage(message, (response) => {
            // 전송 후 발생하는 런타임 에러(컨텍스트 무효화 등)를 잡아서 무시
            if (chrome.runtime.lastError) {
                // console.warn("Context invalidated, ignoring message.");
            }
        });
    } catch (e) {
        // 완전히 연결이 끊긴 경우 예외 처리
    }
}

const AnxietySensor = {
    // 1. 데이터 전송 (Background로 전달)
    send: function(metric) {
        safeSendMessage({ type: "TRACK_ANXIETY", metric: metric });
    },

    // 2. 이벤트 리스너 등록
    init: function() {
        // 클릭 감지
        document.addEventListener('mousedown', () => this.send('clicks'), true);

        // 백스페이스 감지 (생각의 파편화)
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace') this.send('backspaces');
        }, true);

        // 텍스트 드래그 감지 (mouseup 시 선택 영역 확인)
        document.addEventListener('mouseup', () => {
            const selection = window.getSelection().toString();
            if (selection.length > 0) this.send('dragCount');
        }, true);

        // 뒤로가기 감지
        window.addEventListener('popstate', () => this.send('backHistory'));

        // 비디오 스킵 감지 (유튜브 등)
        document.addEventListener('seeking', (e) => {
            if (e.target.tagName === 'VIDEO') this.send('videoSkips');
        }, true);
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
          removeRootAttribute('data-friction-hover-reveal');
          if (NudgeGame.isActive() && NudgeGame.getMode() !== 'debug') {
              NudgeGame.stop();
          }
          sendResponse?.({ ok: true });
          return false;
      }

    if (!request || !request.filters) return;
    const { filters } = request;

    const hoverRevealSetting = filters.hoverReveal;
    const hoverRevealEnabled = hoverRevealSetting ? !!hoverRevealSetting.isActive : true;
    if (hoverRevealEnabled) setRootAttribute('data-friction-hover-reveal', '1');
    else removeRootAttribute('data-friction-hover-reveal');
     
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
      TextShuffleManager.update(filters.textShuffle, { hoverRevealEnabled });
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
            hoverReveal: { isActive: true, value: '' },
            letterSpacing: { isActive: false, value: '0.1em' },
            textOpacity: { isActive: false, value: '1' },
            textBlur: { isActive: false, value: '0.3px' },
            textShadow: { isActive: false, value: '0 1px 0 rgba(0,0,0,0.25)' },
           textShuffle: { isActive: false, value: 0.15 },
           inputDelay: { isActive: false, value: 120 },
      } 
  }, (items) => {
    
    const url = window.location.href;
    const hostname = getHostname(url);
    const isBlocked = hostname && items.blockedUrls.includes(hostname);
    const isTimeActive = isFrictionTime(items.schedule);

      if (isBlocked && isTimeActive) {
          const filters = items.filterSettings;
          const hoverRevealSetting = filters.hoverReveal;
          const hoverRevealEnabled = hoverRevealSetting ? !!hoverRevealSetting.isActive : true;
          if (hoverRevealEnabled) setRootAttribute('data-friction-hover-reveal', '1');
          else removeRootAttribute('data-friction-hover-reveal');
          TextManager.update(filters);
          TextShuffleManager.update(filters.textShuffle, { hoverRevealEnabled });
          if (filters.delay?.isActive) DelayManager.apply(filters.delay.value);
          if (filters.inputDelay?.isActive) InputDelayManager.apply(filters.inputDelay.value);
          if (filters.clickDelay?.isActive) InteractionManager.applyClickDelay(filters.clickDelay.value);
          if (filters.scrollFriction?.isActive) InteractionManager.applyScroll(filters.scrollFriction.value);
          VisualManager.update(filters);
      }
  });

AnxietySensor.init();