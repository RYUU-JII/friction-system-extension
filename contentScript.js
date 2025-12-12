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

const STYLES = {
    VISUAL: { ID: 'friction-visual-style', ATTR: 'data-visual-applied' },
    DELAY: { ID: 'friction-delay-style', ATTR: 'data-delay-applied' },
    SPACING: { ID: 'friction-spacing-style', ATTR: 'data-spacing-applied' }
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
    // VISUAL_TARGETS는 다양한 시각적 요소를 포함하도록 확장되었습니다.
    VISUAL_TARGETS: ':is(.feed-item, .recommendation-tile, .suggested-videos, .related-posts, .thumbnail-image, .post-preview, #comments, .comment-list, .discussion-area, .ad-container, .promotion-box, [data-ad-type], [id*="ad"], [class*="ad"], .stickyunit, .search-result-item, .snippet-text, a, button, a img, video, ytd-reel-video-renderer, [role="article"], p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th)',
    
    // INTERACTIVE_TARGETS는 네비게이션 및 인터랙션 요소를 포괄하도록 확장되었습니다.
    INTERACTIVE_TARGETS: ':is(a, button, article, [onclick], input[type="submit"], input[type="image"], [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="article"], [role="menuitem"], [role="option"], [role="tab"], [class*="link"], [class*="button"], [class*="btn"], figure):not(.stickyunit)',
    
    TEXT_TARGETS: ':is(p, span:not([role]), li, h1, h2, h3, h4, h5, h6, blockquote, td, th, a)'
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
        const isActive = (blur && blur.isActive) || (desat && desat.isActive);

        if (!isActive) {
            this.remove();
            return;
        }

        const filterValues = [];
        if (blur && blur.isActive) filterValues.push(`blur(${blur.value})`);
        if (desat && desat.isActive) filterValues.push(`grayscale(${desat.value})`);

        const combinedFilter = filterValues.join(' ');
        
        let style = document.getElementById(STYLES.VISUAL.ID);
        if (!style) {
            style = document.createElement('style');
            style.id = STYLES.VISUAL.ID;
            document.head.appendChild(style);
        }

        // ✨ 핵심 수정: html 태그의 속성을 확인하고, will-change를 제거했습니다.
        // ✨ 핵심 추가: :has(:hover)를 통해 이중 필터링을 방지합니다.
        style.textContent = `
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_TARGETS} {
                filter: ${combinedFilter} !important;
                transition: filter 0.1s ease;
                /* will-change: filter; 제거 */
            }
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_TARGETS}:hover {
                filter: none !important;
            }
            /* 이중 필터 버그 수정: 자식 요소가 호버되면 부모 필터도 해제 */
            html:not([${STYLES.VISUAL.ATTR}="none"]) ${SELECTORS.VISUAL_TARGETS}:has(:hover) {
                filter: none !important;
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

const InteractionManager = {
    handleClick(e) {
        const el = e.target.closest(SELECTORS.INTERACTIVE_TARGETS);
    
        if (!el) return;

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
            el.tagName === 'FIGURE' || // figure 추가
            el.hasAttribute('href') || 
            el.hasAttribute('onclick') ||
            el.matches('input[type="submit"]') ||
            el.matches('input[type="image"]') || // input type=image 추가
            
            // ARIA Role 검증 강화
            el.getAttribute('role') === 'link' ||
            el.getAttribute('role') === 'button' ||
            el.getAttribute('role') === 'article' ||
            el.getAttribute('role') === 'menuitem' || // 메뉴 아이템 추가
            el.getAttribute('role') === 'option' ||   // 선택지 아이템 추가
            el.getAttribute('role') === 'tab' ||      // 탭 아이템 추가
            
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
        TextManager.removeSpacing();
        InteractionManager.removeClickDelay();
        InteractionManager.removeScroll();
        return;
    }

    const { filters } = request;
    
    VisualManager.update(filters);

    if (filters.delay?.isActive) DelayManager.apply(filters.delay.value);
    else DelayManager.remove();

    if (filters.clickDelay?.isActive) InteractionManager.applyClickDelay(filters.clickDelay.value);
    else InteractionManager.removeClickDelay();

    if (filters.scrollFriction?.isActive) InteractionManager.applyScroll(filters.scrollFriction.value);
    else InteractionManager.removeScroll();

    if (filters.letterSpacing?.isActive) TextManager.applySpacing(filters.letterSpacing.value);
    else TextManager.removeSpacing();
});

// ===========================================================
// 5. Helpers
// ===========================================================

function getHostname(url) {
    try {
        const u = new URL(url);
        return u.hostname.replace(/^www\./, '');
    } catch (e) {
        return null;
    }
}

function checkTimeCondition(schedule) {
    if (!schedule || !schedule.scheduleActive) return true;

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const { startMin, endMin } = schedule;
    
    if (startMin < endMin) {
        return currentMinutes >= startMin && currentMinutes < endMin;
    } else {
        return currentMinutes >= startMin || currentMinutes < endMin;
    }
}

// ===========================================================
// 6. Early Filter Application
// ===========================================================

chrome.storage.local.get({
    blockedUrls: [], 
    schedule: { scheduleActive: false, startMin: 0, endMin: 1440 },
    filterSettings: {
        blur: { isActive: false, value: '1.5px' },
        delay: { isActive: false, value: '0.5s' },
        desaturation: { isActive: false, value: '50%' },
        letterSpacing: { isActive: false, value: '0.1em' }
    } 
}, (items) => {
    
    const url = window.location.href;
    const hostname = getHostname(url);
    const isBlocked = hostname && items.blockedUrls.includes(hostname);
    const isTimeActive = checkTimeCondition(items.schedule); 

    if (isBlocked && isTimeActive) {
        const filters = items.filterSettings;
        if (filters.letterSpacing?.isActive) {
            TextManager.applySpacing(filters.letterSpacing.value); 
        }
        if (filters.blur?.isActive || filters.desaturation?.isActive || filters.delay?.isActive) {
             VisualManager.update(filters);
             if (filters.delay?.isActive) DelayManager.apply(filters.delay.value);
        }
    }
});