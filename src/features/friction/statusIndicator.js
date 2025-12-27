const STATUS_TEXT = {
  on: '필터 적용중',
  off: '필터 비활성',
};

const FILTER_LABELS = {
  blur: '블러',
  saturation: '채도 감소',
  letterSpacing: '글자 간격',
  textOpacity: '글자 투명도',
  textShadow: '텍스트 그림자',
  textShuffle: '텍스트 셔플',
  clickDelay: 'Click Delay',
  scrollFriction: 'Scroll Batching',
  inputDelay: '입력 지연',
  socialMetrics: '사회적 지표 숨김',
};

function formatDurationParts(ms) {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return { hours, minutes };
}

function parseShadowAlpha(value) {
  const match = String(value || '').match(/rgba\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\s*\)/i);
  if (!match) return null;
  const alpha = parseFloat(match[1]);
  return Number.isFinite(alpha) ? Math.max(0, Math.min(1, alpha)) : null;
}

function parseShadowBlur(value) {
  const matches = String(value || '').match(/-?\d+(?:\.\d+)?px/g) || [];
  if (matches.length < 3) return null;
  const blur = parseFloat(matches[2]);
  return Number.isFinite(blur) ? blur : null;
}

function getShadowLevelLabel(value) {
  const alpha = parseShadowAlpha(value);
  if (alpha !== null) {
    if (alpha <= 0.33) return '약';
    if (alpha <= 0.55) return '중';
    return '강';
  }
  const blur = parseShadowBlur(value);
  if (blur !== null) {
    if (blur <= 1.2) return '약';
    if (blur <= 2.4) return '중';
    return '강';
  }
  return '중';
}

function getFaviconUrl(hostname) {
  if (!hostname) return '';
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(hostname)}&sz=64`;
}

function buildFilterSummary(filters, shouldApply) {
  if (!filters || !shouldApply) return [];

  const items = [];
  const pushStep = (key) => {
    if (!filters[key]?.isActive) return;
    const step = filters[key]?.step || 1;
    items.push(`${FILTER_LABELS[key]} Lv${step}`);
  };

  pushStep('blur');
  pushStep('saturation');
  pushStep('letterSpacing');
  pushStep('textOpacity');
  pushStep('clickDelay');
  pushStep('scrollFriction');

  if (filters.textShadow?.isActive) {
    items.push(`${FILTER_LABELS.textShadow} ${getShadowLevelLabel(filters.textShadow.value)}`);
  }
  if (filters.textShuffle?.isActive) {
    items.push(`${FILTER_LABELS.textShuffle} ON`);
  }
  if (filters.inputDelay?.isActive) {
    const delay = Math.round(Number(filters.inputDelay.value) || 0);
    items.push(`${FILTER_LABELS.inputDelay} ${delay}ms`);
  }
  if (filters.socialEngagement?.isActive || filters.socialExposure?.isActive) {
    items.push(FILTER_LABELS.socialMetrics);
  }

  return items;
}

function requestIndicatorInfo() {
  return new Promise((resolve) => {
    if (!chrome?.runtime?.sendMessage || !chrome.runtime?.id) {
      resolve(null);
      return;
    }

    try {
      chrome.runtime.sendMessage({ action: 'GET_FILTER_INDICATOR_INFO', url: location.href }, (resp) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(resp && resp.success ? resp : null);
      });
    } catch (_) {
      resolve(null);
    }
  });
}

const INDICATOR_STORAGE_KEY = 'frictionIndicatorPosition';
const INDICATOR_MARGIN_PX = 12;
const TOOLTIP_OFFSET_PX = 10;

function loadStoredPosition() {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) {
      resolve(null);
      return;
    }
    chrome.storage.local.get({ [INDICATOR_STORAGE_KEY]: null }, (items) => {
      resolve(items?.[INDICATOR_STORAGE_KEY] || null);
    });
  });
}

function saveStoredPosition(pos) {
  if (!chrome?.storage?.local) return;
  chrome.storage.local.set({ [INDICATOR_STORAGE_KEY]: pos });
}

function clampValue(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getViewportSize() {
  return {
    width: document.documentElement?.clientWidth || window.innerWidth,
    height: document.documentElement?.clientHeight || window.innerHeight,
  };
}

function pickTooltipPosition(root, tooltip) {
  const rect = root.getBoundingClientRect();
  const tipRect = tooltip.getBoundingClientRect();
  if (!tipRect.width || !tipRect.height) return 'top-right';
  const viewport = getViewportSize();

  const canTop = rect.top >= tipRect.height + TOOLTIP_OFFSET_PX;
  const canBottom = viewport.height - rect.bottom >= tipRect.height + TOOLTIP_OFFSET_PX;
  const canRight = rect.right >= tipRect.width;
  const canLeft = rect.left + tipRect.width <= viewport.width;

  const vertical = canTop ? 'top' : canBottom ? 'bottom' : rect.top >= viewport.height - rect.bottom ? 'top' : 'bottom';
  const horizontal = canRight ? 'right' : canLeft ? 'left' : rect.right >= viewport.width - rect.left ? 'right' : 'left';
  return `${vertical}-${horizontal}`;
}

function clampPositionToViewport(x, y, rect) {
  const viewport = getViewportSize();
  const maxX = Math.max(INDICATOR_MARGIN_PX, viewport.width - rect.width - INDICATOR_MARGIN_PX);
  const maxY = Math.max(INDICATOR_MARGIN_PX, viewport.height - rect.height - INDICATOR_MARGIN_PX);
  return {
    x: clampValue(x, INDICATOR_MARGIN_PX, maxX),
    y: clampValue(y, INDICATOR_MARGIN_PX, maxY),
  };
}

function snapPositionToEdge(x, y, rect) {
  const viewport = getViewportSize();
  const distances = [
    { edge: 'left', value: x },
    { edge: 'right', value: viewport.width - (x + rect.width) },
    { edge: 'top', value: y },
    { edge: 'bottom', value: viewport.height - (y + rect.height) },
  ];
  distances.sort((a, b) => a.value - b.value);
  const closest = distances[0]?.edge || 'right';

  let nextX = x;
  let nextY = y;
  if (closest === 'left') {
    nextX = INDICATOR_MARGIN_PX;
  } else if (closest === 'right') {
    nextX = viewport.width - rect.width - INDICATOR_MARGIN_PX;
  } else if (closest === 'top') {
    nextY = INDICATOR_MARGIN_PX;
  } else if (closest === 'bottom') {
    nextY = viewport.height - rect.height - INDICATOR_MARGIN_PX;
  }

  return clampPositionToViewport(nextX, nextY, rect);
}

const StatusIndicator = (() => {
  let root = null;
  let pillText = null;
  let urlText = null;
  let timeText = null;
  let filterText = null;
  let faviconImg = null;
  let hoverToken = 0;
  let lastHoverFetchAt = 0;
  let positionLoaded = false;
  let dragActive = false;
  let dragPointerId = null;
  let dragOffset = { x: 0, y: 0 };
  const state = {
    isBlocked: false,
    isBlockedDomain: false,
    filters: null,
    indicatorEnabled: true,
  };

  function applyPosition(x, y) {
    if (!root) return;
    root.style.left = `${Math.round(x)}px`;
    root.style.top = `${Math.round(y)}px`;
    root.style.right = 'auto';
    root.style.bottom = 'auto';
  }

  async function restorePosition() {
    if (!root || positionLoaded) return;
    positionLoaded = true;
    const stored = await loadStoredPosition();
    if (!stored || typeof stored.x !== 'number' || typeof stored.y !== 'number') return;
    const rect = root.getBoundingClientRect();
    const clamped = clampPositionToViewport(stored.x, stored.y, rect);
    applyPosition(clamped.x, clamped.y);
  }

  function handleResize() {
    if (!root || root.style.left === '') return;
    const rect = root.getBoundingClientRect();
    const clamped = clampPositionToViewport(rect.left, rect.top, rect);
    applyPosition(clamped.x, clamped.y);
    updateTooltipPlacement();
  }

  function handlePointerDown(e) {
    if (!root || e.button !== 0) return;
    const pill = e.target?.closest?.('.friction-status-indicator__pill');
    if (!pill) return;
    e.preventDefault();
    dragActive = true;
    dragPointerId = e.pointerId;
    const rect = root.getBoundingClientRect();
    dragOffset = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    root.classList.add('is-dragging');
    root.setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e) {
    if (!dragActive || (dragPointerId !== null && e.pointerId !== dragPointerId) || !root) return;
    const rect = root.getBoundingClientRect();
    const nextX = e.clientX - dragOffset.x;
    const nextY = e.clientY - dragOffset.y;
    const clamped = clampPositionToViewport(nextX, nextY, rect);
    applyPosition(clamped.x, clamped.y);
  }

  function endDrag(e) {
    if (!dragActive || !root) return;
    if (dragPointerId !== null && e?.pointerId !== undefined && e.pointerId !== dragPointerId) return;
    dragActive = false;
    dragPointerId = null;
    root.classList.remove('is-dragging');
    root.releasePointerCapture?.(e.pointerId);
    const rect = root.getBoundingClientRect();
    const snapped = snapPositionToEdge(rect.left, rect.top, rect);
    applyPosition(snapped.x, snapped.y);
    saveStoredPosition({ x: snapped.x, y: snapped.y });
    updateTooltipPlacement();
  }

  function updateTooltipPlacement() {
    if (!root) return;
    const tooltip = root.querySelector('.friction-status-indicator__tooltip');
    if (!tooltip) return;
    root.dataset.tooltipPosition = pickTooltipPosition(root, tooltip);
  }

  function ensure() {
    if (root || !document?.documentElement) return;
    root = document.createElement('div');
    root.className = 'friction-status-indicator';
    root.dataset.frictionIndicator = '1';
    root.dataset.state = 'off';
    root.style.display = 'none';
    root.innerHTML = `
      <div class="friction-status-indicator__pill" role="status" aria-live="polite">
        <span class="friction-status-indicator__dot"></span>
        <span class="friction-status-indicator__text"></span>
      </div>
      <div class="friction-status-indicator__tooltip" role="tooltip">
        <div class="friction-status-indicator__header">
          <div class="friction-status-indicator__url-wrap">
            <span class="friction-status-indicator__icon">URL</span>
            <span class="friction-status-indicator__url"></span>
          </div>
          <div class="friction-status-indicator__status-side">
            <div class="friction-status-indicator__favicon-wrapper">
              <img class="friction-status-indicator__favicon" alt="site favicon" />
              <div class="friction-status-indicator__pulse"></div>
            </div>
          </div>
        </div>
        <div class="friction-status-indicator__divider"></div>
        <div class="friction-status-indicator__content">
          <div class="friction-status-indicator__row">
            <span class="friction-status-indicator__label">누적시간</span>
            <span class="friction-status-indicator__data" data-field="time"></span>
          </div>
          <div class="friction-status-indicator__row friction-status-indicator__row--filters">
            <span class="friction-status-indicator__label">적용필터</span>
            <div class="friction-status-indicator__filter-group" data-field="filters"></div>
          </div>
        </div>
      </div>
    `;

    document.documentElement.appendChild(root);
    pillText = root.querySelector('.friction-status-indicator__text');
    urlText = root.querySelector('.friction-status-indicator__url');
    timeText = root.querySelector('[data-field="time"]');
    filterText = root.querySelector('[data-field="filters"]');
    faviconImg = root.querySelector('.friction-status-indicator__favicon');

    void restorePosition();

    root.addEventListener('mouseenter', () => {
      updateTooltipPlacement();
      void handleHover();
    });
    root.addEventListener('pointerdown', handlePointerDown);
    root.addEventListener('pointermove', handlePointerMove);
    root.addEventListener('pointerup', endDrag);
    root.addEventListener('pointercancel', endDrag);
    window.addEventListener('resize', handleResize);
  }

  function setVisible(visible) {
    if (!root) return;
    root.style.display = visible ? 'block' : 'none';
  }

  function update(next = {}) {
    ensure();
    if (!root) return;

    if (typeof next.isBlockedDomain === 'boolean') {
      state.isBlockedDomain = next.isBlockedDomain;
    }
    if (typeof next.isBlocked === 'boolean') {
      state.isBlocked = next.isBlocked;
    }
    if (typeof next.indicatorEnabled === 'boolean') {
      state.indicatorEnabled = next.indicatorEnabled;
    }
    if (next.filters) state.filters = next.filters;

    setVisible(state.isBlockedDomain && state.indicatorEnabled);
    root.dataset.state = state.isBlocked ? 'on' : 'off';
    if (pillText) {
      pillText.textContent = state.isBlocked ? STATUS_TEXT.on : STATUS_TEXT.off;
    }
  }

  function setTooltipLoading() {
    if (urlText) urlText.textContent = location.hostname || '현재 페이지';
    if (timeText) timeText.textContent = '불러오는 중...';
    if (filterText) filterText.textContent = '불러오는 중...';
  }

  function updateTooltip(info) {
    const hostname = info?.hostname || location.hostname || '현재 페이지';
    if (urlText) urlText.textContent = hostname;
    if (faviconImg) {
      const src = getFaviconUrl(info?.hostname || location.hostname || '');
      if (src) {
        if (faviconImg.getAttribute('src') !== src) faviconImg.setAttribute('src', src);
        faviconImg.alt = `${hostname} favicon`;
      } else {
        faviconImg.removeAttribute('src');
      }
    }
    if (timeText) {
      const parts = formatDurationParts(info?.dailyMs || 0);
      timeText.innerHTML = `
        <span class="indicator-time-value">${parts.hours}</span>
        <span class="indicator-time-unit">h</span>
        <span class="indicator-time-value">${String(parts.minutes).padStart(2, '0')}</span>
        <span class="indicator-time-unit">m</span>
      `;
    }
    if (filterText) {
      const items = buildFilterSummary(info?.filters || state.filters, info?.shouldApply);
      if (!items.length) {
        filterText.textContent = '없음';
      } else {
        filterText.innerHTML = items
          .map((item) => `<span class="friction-status-indicator__filter-item">${item}</span>`)
          .join('');
      }
    }
  }

  async function handleHover() {
    if (dragActive) return;
    const now = Date.now();
    if (now - lastHoverFetchAt < 800) return;
    lastHoverFetchAt = now;

    setTooltipLoading();
    const token = ++hoverToken;
    const info = await requestIndicatorInfo();
    if (token !== hoverToken || !info) return;

    update({
      isBlocked: info.shouldApply,
      isBlockedDomain: info.isBlockedDomain,
      filters: info.filters,
      indicatorEnabled: info.indicatorEnabled,
    });
    updateTooltip(info);
  }

  return { update };
})();

export default StatusIndicator;
