import { aggregateOverview } from '../../dataManager.js';

export function createOverviewTab({ UI, getState, onToggleBlockDomain }) {
  let slideIndex = 0;

  function renderEmptyState(container, message) {
    const el = document.createElement('div');
    el.className = 'empty-state';
    el.textContent = message;
    container.innerHTML = '';
    container.appendChild(el);
  }

  function renderSimpleList(container, data, useGradient = true, emptyMessage = '표시할 데이터가 없어요.') {
    container.innerHTML = '';
    if (!Array.isArray(data) || data.length === 0) {
      renderEmptyState(container, emptyMessage);
      return;
    }

    const realItems = data.filter((item) => item && !item.isPlaceholder);
    const maxVal = realItems.length > 0 ? Math.max(...realItems.map((item) => item.totalTime || 0), 1) : 1;

    data.forEach((item) => {
      const isPlaceholder = !!item?.isPlaceholder;
      const barWidth = isPlaceholder ? 0 : (item.totalTime / maxVal) * 100;
      const el = document.createElement('div');
      el.className = `recap-item${isPlaceholder ? ' is-placeholder' : ''}`;
      const barClass = `usage-bar${useGradient ? ' is-gradient' : ''} ${item.isBlocked ? 'is-blocked' : ''}`.trim();

      if (isPlaceholder) {
        el.innerHTML = `
          <div class="${barClass}" style="width: 0%"></div>
          <div class="recap-content">
            <div class="domain-info">
              <div class="favicon is-placeholder" aria-hidden="true"></div>
              <span class="domain-name is-placeholder">${item.domain || '—'}</span>
            </div>
            <div class="stats-group">
              <span class="time is-placeholder">${item.timeStr || '—'}</span>
            </div>
          </div>
        `;
      } else {
        el.innerHTML = `
          <div class="${barClass}" style="width: ${barWidth}%"></div>
          <div class="recap-content">
            <div class="domain-info">
              <div class="favicon" style="background-image: url('https://www.google.com/s2/favicons?domain=${item.domain}&sz=32')"></div>
              <span class="domain-name">${item.domain}</span>
            </div>
            <div class="stats-group">
              <span class="time">${item.timeStr}</span>
              <button class="list-block-btn ${item.isBlocked ? 'is-blocked' : ''}" data-domain="${item.domain}">
                ${item.isBlocked ? '해제' : '차단'}
              </button>
            </div>
          </div>
        `;
      }

      container.appendChild(el);
    });
  }

  function renderDiffList(container, data, type, emptyMessage = '표시할 데이터가 없어요.') {
    container.innerHTML = '';
    if (!Array.isArray(data) || data.length === 0) {
      renderEmptyState(container, emptyMessage);
      return;
    }
    const badgeClass = type === 'increase' ? 'increase' : 'decrease';

    data.forEach((item) => {
      const isPlaceholder = !!item?.isPlaceholder;
      const el = document.createElement('div');
      el.className = `recap-item${isPlaceholder ? ' is-placeholder' : ''}`;

      if (isPlaceholder) {
        el.innerHTML = `
          <div class="recap-content">
            <div class="domain-info">
              <div class="favicon is-placeholder" aria-hidden="true"></div>
              <div class="text-group">
                <span class="domain-name is-placeholder">${item.domain || '—'}</span>
                <div class="diff-info is-placeholder">어제 — → 오늘 —</div>
              </div>
            </div>
            <div class="stats-group">
              <span class="diff-badge ${badgeClass}">${item.diffStr || '—'}</span>
            </div>
          </div>
        `;
      } else {
        el.innerHTML = `
          <div class="recap-content">
            <div class="domain-info">
              <div class="favicon" style="background-image: url('https://www.google.com/s2/favicons?domain=${item.domain}&sz=32')"></div>
              <div class="text-group">
                <span class="domain-name">${item.domain}</span>
                <div class="diff-info">어제 ${item.yesterdayStr} → 오늘 ${item.todayStr}</div>
              </div>
            </div>
            <div class="stats-group">
              <span class="diff-badge ${badgeClass}">${item.diffStr}</span>
              <button class="list-block-btn ${item.isBlocked ? 'is-blocked' : ''}" data-domain="${item.domain}">
                ${item.isBlocked ? '해제' : '차단'}
              </button>
            </div>
          </div>
        `;
      }

      container.appendChild(el);
    });
  }

  function ensureLength(items, count, makePlaceholder) {
    const src = Array.isArray(items) ? items.slice(0, count) : [];
    const hasReal = src.length > 0;
    while (src.length < count) src.push(makePlaceholder(src.length, hasReal));
    return src;
  }

  function setupCarousel() {
    if (!UI.overviewCarousel || !UI.overviewSlides || UI.overviewSlides.length === 0) return;

    UI.overviewCarousel.tabIndex = UI.overviewCarousel.tabIndex >= 0 ? UI.overviewCarousel.tabIndex : 0;

    const slides = Array.from(UI.overviewSlides);
    const dotContainer = UI.overviewDots;

    if (dotContainer) {
      dotContainer.innerHTML = '';
      slides.forEach((slide, idx) => {
        const title = slide.getAttribute('data-slide-title') || `카드 ${idx + 1}`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'carousel-dot';
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-label', `${idx + 1}번 카드: ${title}`);
        btn.addEventListener('click', () => setSlide(idx));
        dotContainer.appendChild(btn);
      });
    }

    if (UI.overviewPrev) UI.overviewPrev.addEventListener('click', () => moveSlide(-1));
    if (UI.overviewNext) UI.overviewNext.addEventListener('click', () => moveSlide(1));

    UI.overviewCarousel.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') moveSlide(-1);
      if (e.key === 'ArrowRight') moveSlide(1);
    });

    let touchStartX = 0;
    let touchStartY = 0;
    let touchActive = false;

    UI.overviewCarousel.addEventListener(
      'touchstart',
      (e) => {
        const t = e.touches && e.touches[0];
        if (!t) return;
        touchActive = true;
        touchStartX = t.clientX;
        touchStartY = t.clientY;
      },
      { passive: true }
    );

    UI.overviewCarousel.addEventListener(
      'touchend',
      (e) => {
        if (!touchActive) return;
        touchActive = false;
        const t = e.changedTouches && e.changedTouches[0];
        if (!t) return;
        const dx = t.clientX - touchStartX;
        const dy = t.clientY - touchStartY;
        if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
        moveSlide(dx > 0 ? -1 : 1);
      },
      { passive: true }
    );

    setSlide(0, { immediate: true });
  }

  function setSlide(nextIndex, opts = {}) {
    if (!UI.overviewSlides || UI.overviewSlides.length === 0) return;
    const slides = Array.from(UI.overviewSlides);
    const max = slides.length;
    const prev = slideIndex;
    const idx = ((nextIndex % max) + max) % max;
    const activeSlide = slides[idx];

    const activeEl = document.activeElement;
    const focusedSlide = activeEl instanceof Element ? slides.find((s) => s.contains(activeEl)) : null;
    if (focusedSlide && focusedSlide !== activeSlide) {
      const focusTarget =
        activeSlide.querySelector(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        ) || activeSlide;
      if (focusTarget instanceof HTMLElement) focusTarget.focus({ preventScroll: true });
    }

    slideIndex = idx;

    slides.forEach((slide, i) => {
      slide.classList.remove('is-active', 'is-prev', 'is-next', 'is-immediate');
      if (opts.immediate) slide.classList.add('is-immediate');

      if (i === idx) slide.classList.add('is-active');
      else if (i === (idx - 1 + max) % max) slide.classList.add('is-prev');
      else if (i === (idx + 1) % max) slide.classList.add('is-next');

      if (i === idx) {
        slide.removeAttribute('inert');
        slide.setAttribute('aria-hidden', 'false');
        slide.tabIndex = 0;
      } else {
        slide.setAttribute('inert', '');
        slide.setAttribute('aria-hidden', 'true');
        slide.tabIndex = -1;
      }
    });

    if (UI.overviewDots) {
      const dots = Array.from(UI.overviewDots.querySelectorAll('.carousel-dot'));
      dots.forEach((dot, i) => {
        dot.classList.toggle('is-active', i === idx);
        dot.setAttribute('aria-selected', i === idx ? 'true' : 'false');
      });
    }

    if (UI.overviewPrev) UI.overviewPrev.disabled = max <= 1;
    if (UI.overviewNext) UI.overviewNext.disabled = max <= 1;

    if (prev !== idx) syncCarouselHeight();
  }

  function moveSlide(direction) {
    if (!UI.overviewSlides || UI.overviewSlides.length === 0) return;
    setSlide(slideIndex + (direction < 0 ? -1 : 1));
  }

  function syncCarouselHeight() {
    if (!UI.overviewCarouselTrack || !UI.overviewSlides || UI.overviewSlides.length === 0) return;
    const slides = Array.from(UI.overviewSlides);
    const active = slides.find((s) => s.classList.contains('is-active')) || slides[0];
    requestAnimationFrame(() => {
      const h = active.offsetHeight;
      if (h > 0) UI.overviewCarouselTrack.style.height = `${h}px`;
    });
  }

  async function display() {
    const { currentStats, currentBlockedUrls } = getState();
    const { topUsed, top5Background, top5Increase, top5Decrease } = aggregateOverview(currentStats, currentBlockedUrls);

    const lists = {
      total: document.getElementById('topUsedList'),
      background: document.getElementById('backgroundList'),
      increase: document.getElementById('increaseList'),
      decrease: document.getElementById('decreaseList'),
    };
    if (!lists.total) return;

    const topUsedPadded = ensureLength(topUsed, 5, (i, hasReal) => ({
      isPlaceholder: true,
      domain: hasReal ? '—' : i === 0 ? '기록 없음' : '—',
      totalTime: 0,
      timeStr: '—',
      isBlocked: false,
    }));

    const backgroundPadded = ensureLength(top5Background, 5, (i, hasReal) => ({
      isPlaceholder: true,
      domain: hasReal ? '—' : i === 0 ? '기록 없음' : '—',
      totalTime: 0,
      timeStr: '—',
      isBlocked: false,
    }));

    const increasePadded = ensureLength(top5Increase, 5, (i, hasReal) => ({
      isPlaceholder: true,
      domain: hasReal ? '—' : i === 0 ? '기록 없음' : '—',
      diffStr: '—',
      todayStr: '—',
      yesterdayStr: '—',
      isBlocked: false,
    }));

    const decreasePadded = ensureLength(top5Decrease, 5, (i, hasReal) => ({
      isPlaceholder: true,
      domain: hasReal ? '—' : i === 0 ? '기록 없음' : '—',
      diffStr: '—',
      todayStr: '—',
      yesterdayStr: '—',
      isBlocked: false,
    }));

    renderSimpleList(lists.total, topUsedPadded, true, '오늘(포그라운드) 기록이 아직 없어요. 브라우징 후 다시 확인해 주세요.');
    renderSimpleList(lists.background, backgroundPadded, false, '백그라운드 기록이 아직 없어요.');
    renderDiffList(lists.increase, increasePadded, 'increase', '눈에 띄는 증가가 없어요.');
    renderDiffList(lists.decrease, decreasePadded, 'decrease', '눈에 띄는 감소가 없어요.');

    syncCarouselHeight();
  }

  function setup() {
    setupCarousel();
    if (UI.overview) {
      UI.overview.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('.list-block-btn') : null;
        if (!btn || !UI.overview.contains(btn)) return;
        const domain = btn.dataset.domain;
        if (domain) onToggleBlockDomain(domain);
      });
    }
  }

  return { setup, display, syncCarouselHeight };
}

