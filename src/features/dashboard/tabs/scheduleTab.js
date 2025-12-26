export function createScheduleTab({ UI, getSchedule, setSchedule }) {
  let isBound = false;
  let selectedBlockId = null;

  const MINUTES_IN_DAY = 1440;
  const STEP_MINUTES = 10;
  const MAX_START_MIN = MINUTES_IN_DAY - STEP_MINUTES;
  const DAY_LABELS = ['일', '월', '화', '수', '목', '금', '토'];
  const DAY_PRESETS = {
    weekday: [1, 2, 3, 4, 5],
    weekend: [0, 6],
    all: [0, 1, 2, 3, 4, 5, 6],
  };

  function generateId() {
    return `block-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
  }

  function minToTime(minutes) {
    const safe = Math.max(0, Math.min(MINUTES_IN_DAY, Math.round(minutes || 0)));
    if (safe === MINUTES_IN_DAY) return '24:00';
    const h = Math.floor(safe / 60);
    const m = safe % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function snapMinutes(minutes) {
    return Math.round(minutes / STEP_MINUTES) * STEP_MINUTES;
  }

  function clampStart(minutes) {
    return Math.max(0, Math.min(MAX_START_MIN, minutes));
  }

  function clampEnd(minutes) {
    return Math.max(0, Math.min(MINUTES_IN_DAY, minutes));
  }

  function parseTimeInput(value, allow24 = false) {
    if (!value) return null;
    const match = String(value).trim().match(/^(\d{1,2})\s*:\s*(\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours === 24 && minutes === 0) return allow24 ? MINUTES_IN_DAY : null;
    if (hours < 0 || hours > 23) return null;
    if (minutes < 0 || minutes > 59) return null;
    return hours * 60 + minutes;
  }

  function normalizeDays(days) {
    if (!Array.isArray(days)) return [];
    const unique = new Set();
    days.forEach((day) => {
      const value = Number(day);
      if (Number.isInteger(value) && value >= 0 && value <= 6) unique.add(value);
    });
    return Array.from(unique).sort((a, b) => a - b);
  }

  function normalizeBlocks(blocks, fallbackStart, fallbackEnd) {
    let didChange = false;
    let nextBlocks = Array.isArray(blocks) && blocks.length > 0 ? blocks : null;
    if (!nextBlocks) {
      nextBlocks = [{ startMin: fallbackStart, endMin: fallbackEnd }];
      didChange = true;
    }

    const normalized = nextBlocks.map((block) => {
      const startRaw = Number.isFinite(block?.startMin) ? block.startMin : fallbackStart;
      const endRaw = Number.isFinite(block?.endMin) ? block.endMin : fallbackEnd;
      let startMin = clampStart(snapMinutes(startRaw));
      let endMin = clampEnd(snapMinutes(endRaw));
      if (startMin !== startRaw || endMin !== endRaw) didChange = true;
      let id = typeof block?.id === 'string' && block.id ? block.id : generateId();
      if (id !== block?.id) didChange = true;
      if (startMin === endMin) {
        endMin = clampEnd(endMin + STEP_MINUTES);
        if (endMin === startMin) {
          startMin = clampStart(startMin - STEP_MINUTES);
        }
        didChange = true;
      }
      return { id, startMin, endMin };
    });

    return { blocks: normalized, didChange };
  }

  function normalizeSchedule(rawSchedule) {
    const base = rawSchedule && typeof rawSchedule === 'object' ? rawSchedule : {};
    let didChange = false;
    const scheduleActive = !!base.scheduleActive;
    if (scheduleActive !== base.scheduleActive) didChange = true;

    let days = normalizeDays(base.days);
    if (days.length === 0) {
      days = DAY_PRESETS.all.slice();
      if (!Array.isArray(base.days) || base.days.length !== days.length) didChange = true;
    }

    const fallbackStart = Number.isFinite(base.startMin) ? base.startMin : 0;
    const fallbackEnd = Number.isFinite(base.endMin) ? base.endMin : MINUTES_IN_DAY;
    const blockResult = normalizeBlocks(base.blocks, fallbackStart, fallbackEnd);
    if (blockResult.didChange) didChange = true;

    const blocks = blockResult.blocks;
    const startMin = blocks[0]?.startMin ?? 0;
    const endMin = blocks[0]?.endMin ?? MINUTES_IN_DAY;

    if (base.startMin !== startMin || base.endMin !== endMin) didChange = true;

    return {
      schedule: { scheduleActive, days, blocks, startMin, endMin },
      didChange,
    };
  }

  function formatDays(days) {
    const normalized = normalizeDays(days);
    const daySet = new Set(normalized);
    if (daySet.size === 7) return '매일';
    if ([1, 2, 3, 4, 5].every((d) => daySet.has(d)) && daySet.size === 5) return '주중';
    if (daySet.has(0) && daySet.has(6) && daySet.size === 2) return '주말';
    return normalized.map((day) => DAY_LABELS[day]).join(' · ');
  }

  function getBlockDuration(block) {
    if (!block) return 0;
    if (block.startMin === block.endMin) return 0;
    if (block.startMin > block.endMin) {
      return MINUTES_IN_DAY - block.startMin + block.endMin;
    }
    return block.endMin - block.startMin;
  }

  function formatDuration(totalMinutes) {
    const safe = Math.max(0, Math.round(totalMinutes || 0));
    const hours = Math.floor(safe / 60);
    const minutes = safe % 60;
    if (hours > 0 && minutes > 0) return `${hours}시간 ${minutes}분`;
    if (hours > 0) return `${hours}시간`;
    return `${minutes}분`;
  }

  function persist(currentSchedule) {
    chrome.storage.local.set({ schedule: currentSchedule }, () => {
      chrome.runtime.sendMessage({ action: 'SCHEDULE_UPDATED' });
    });
  }

  function ensureSelectedBlock(schedule) {
    if (!schedule?.blocks?.length) {
      selectedBlockId = null;
      return null;
    }
    if (!selectedBlockId || !schedule.blocks.some((block) => block.id === selectedBlockId)) {
      selectedBlockId = schedule.blocks[0].id;
    }
    return schedule.blocks.find((block) => block.id === selectedBlockId);
  }

  function updateSummary(schedule) {
    if (!UI.scheduleSummary) return;
    if (!schedule.scheduleActive) {
      UI.scheduleSummary.textContent = '스케줄이 꺼져 있어요. 전체 시간에 마찰 필터가 적용됩니다.';
      return;
    }
    const totalMinutes = schedule.blocks.reduce((sum, block) => sum + getBlockDuration(block), 0);
    const dayLabel = formatDays(schedule.days);
    UI.scheduleSummary.textContent = `활성 요일: ${dayLabel} · 블록 ${schedule.blocks.length}개 · 총 ${formatDuration(
      totalMinutes
    )}`;
  }

  function renderSliderBlocks(schedule) {
    if (!UI.sliderBlocks) return;
    UI.sliderBlocks.innerHTML = '';
    const fragment = document.createDocumentFragment();
    schedule.blocks.forEach((block) => {
      if (block.id === selectedBlockId) return;
      const segments =
        block.startMin > block.endMin
          ? [
              { start: block.startMin, end: MINUTES_IN_DAY },
              { start: 0, end: block.endMin },
            ]
          : [{ start: block.startMin, end: block.endMin }];
      segments.forEach((segment) => {
        const width = Math.max(0, segment.end - segment.start);
        if (width <= 0) return;
        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'slider-block';
        el.style.left = `${(segment.start / MINUTES_IN_DAY) * 100}%`;
        el.style.width = `${(width / MINUTES_IN_DAY) * 100}%`;
        el.dataset.blockId = block.id;
        el.setAttribute('aria-label', '스케줄 블록 선택');
        el.title = `${minToTime(block.startMin)} ~ ${minToTime(block.endMin)}`;
        fragment.appendChild(el);
      });
    });
    UI.sliderBlocks.appendChild(fragment);
  }

  function renderBlockList(schedule) {
    if (!UI.blockList) return;
    UI.blockList.innerHTML = '';
    const fragment = document.createDocumentFragment();
    schedule.blocks.forEach((block, idx) => {
      const row = document.createElement('div');
      row.className = `schedule-block-row${block.id === selectedBlockId ? ' is-active' : ''}`;
      row.dataset.blockId = block.id;

      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.className = 'schedule-block-select';
      selectBtn.dataset.action = 'select-block';
      selectBtn.dataset.blockId = block.id;

      const name = document.createElement('span');
      name.className = 'schedule-block-name';
      name.textContent = `블록 ${idx + 1}`;

      const time = document.createElement('span');
      time.className = 'schedule-block-time';
      time.textContent = `${minToTime(block.startMin)} ~ ${minToTime(block.endMin)}`;

      if (block.startMin > block.endMin) {
        const badge = document.createElement('span');
        badge.className = 'schedule-block-badge';
        badge.textContent = '익일';
        time.appendChild(badge);
      }

      selectBtn.appendChild(name);
      selectBtn.appendChild(time);
      row.appendChild(selectBtn);

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'schedule-block-remove';
      removeBtn.dataset.action = 'remove-block';
      removeBtn.dataset.blockId = block.id;
      removeBtn.textContent = '삭제';
      if (schedule.blocks.length <= 1) removeBtn.disabled = true;
      row.appendChild(removeBtn);

      fragment.appendChild(row);
    });
    UI.blockList.appendChild(fragment);
  }

  function renderPresets(selectedBlock) {
    if (!UI.schedulePresets) return;
    const buttons = UI.schedulePresets.querySelectorAll('[data-start][data-end]');
    buttons.forEach((btn) => {
      const start = Number(btn.dataset.start);
      const end = Number(btn.dataset.end);
      const isActive =
        selectedBlock && selectedBlock.startMin === start && selectedBlock.endMin === end;
      btn.classList.toggle('is-active', isActive);
    });
  }

  function updateUI(nextSchedule) {
    if (!UI.trackWrapper) return;
    const normalized = normalizeSchedule(nextSchedule ?? getSchedule());
    const schedule = normalized.schedule;
    if (normalized.didChange) {
      setSchedule(schedule);
      persist(schedule);
    }

    const selectedBlock = ensureSelectedBlock(schedule);
    if (!selectedBlock) return;

    const startPct = (selectedBlock.startMin / MINUTES_IN_DAY) * 100;
    const endPct = (selectedBlock.endMin / MINUTES_IN_DAY) * 100;
    const wraps = selectedBlock.startMin > selectedBlock.endMin;

    if (UI.handleStart) UI.handleStart.style.left = `${startPct}%`;
    if (UI.handleEnd) UI.handleEnd.style.left = `${endPct}%`;

    if (UI.sliderRange) {
      UI.sliderRange.style.left = `${startPct}%`;
      UI.sliderRange.style.width = `${wraps ? 100 - startPct : Math.max(0, endPct - startPct)}%`;
    }

    if (UI.sliderRangeSecondary) {
      UI.sliderRangeSecondary.style.left = '0%';
      UI.sliderRangeSecondary.style.width = wraps ? `${endPct}%` : '0%';
      UI.sliderRangeSecondary.style.opacity = wraps ? '0.9' : '0';
    }

    if (UI.displayStart) UI.displayStart.textContent = minToTime(selectedBlock.startMin);
    if (UI.displayEnd) UI.displayEnd.textContent = minToTime(selectedBlock.endMin);
    if (UI.startInput) UI.startInput.value = minToTime(selectedBlock.startMin);
    if (UI.endInput) UI.endInput.value = minToTime(selectedBlock.endMin);

    if (UI.scheduleSpanNote) {
      UI.scheduleSpanNote.textContent = wraps ? '익일 종료' : '';
      UI.scheduleSpanNote.classList.toggle('is-visible', wraps);
    }

    if (UI.scheduleToggle) UI.scheduleToggle.checked = schedule.scheduleActive;
    if (UI.scheduleContainer) {
      UI.scheduleContainer.style.opacity = schedule.scheduleActive ? '1' : '0.4';
      UI.scheduleContainer.style.pointerEvents = schedule.scheduleActive ? 'auto' : 'none';
    }

    if (UI.dayButtons) {
      const activeDays = new Set(schedule.days);
      UI.dayButtons.forEach((btn) => {
        const value = Number(btn.dataset.day);
        btn.classList.toggle('is-active', activeDays.has(value));
      });
    }

    updateSummary(schedule);
    renderSliderBlocks(schedule);
    renderBlockList(schedule);
    renderPresets(selectedBlock);
  }

  function commit(nextSchedule) {
    const normalized = normalizeSchedule(nextSchedule ?? getSchedule());
    const schedule = normalized.schedule;
    setSchedule(schedule);
    updateUI(schedule);
    persist(schedule);
  }

  function updateSelectedBlockTime(isStart, minutes, persistNow = false) {
    const normalized = normalizeSchedule(getSchedule());
    const schedule = normalized.schedule;
    if (!schedule.blocks.length) return;
    const blocks = schedule.blocks.map((block) => ({ ...block }));
    const idx = blocks.findIndex((block) => block.id === selectedBlockId);
    if (idx === -1) return;

    const block = { ...blocks[idx] };
    const snapped = snapMinutes(minutes);
    if (isStart) {
      block.startMin = clampStart(snapped);
      if (block.startMin === block.endMin) {
        let candidate = clampStart(block.startMin - STEP_MINUTES);
        if (candidate === block.endMin) candidate = clampStart(block.startMin + STEP_MINUTES);
        block.startMin = candidate;
      }
    } else {
      block.endMin = clampEnd(snapped);
      if (block.startMin === block.endMin) {
        let candidate = clampEnd(block.endMin + STEP_MINUTES);
        if (candidate === block.startMin) candidate = clampEnd(block.endMin - STEP_MINUTES);
        block.endMin = candidate;
      }
    }

    blocks[idx] = block;
    const next = { ...schedule, blocks };
    next.startMin = blocks[0].startMin;
    next.endMin = blocks[0].endMin;

    setSchedule(next);
    updateUI(next);
    if (persistNow) persist(next);
  }

  function applyPreset(startMin, endMin) {
    const normalized = normalizeSchedule(getSchedule());
    const schedule = normalized.schedule;
    const blocks = schedule.blocks.map((block) => ({ ...block }));
    const idx = blocks.findIndex((block) => block.id === selectedBlockId);
    const target = idx >= 0 ? { ...blocks[idx] } : { id: generateId() };
    target.startMin = clampStart(snapMinutes(startMin));
    target.endMin = clampEnd(snapMinutes(endMin));
    if (target.startMin === target.endMin) {
      target.endMin = clampEnd(target.endMin + STEP_MINUTES);
    }

    if (idx >= 0) {
      blocks[idx] = target;
    } else {
      blocks.push(target);
      selectedBlockId = target.id;
    }

    const next = { ...schedule, blocks };
    next.startMin = blocks[0].startMin;
    next.endMin = blocks[0].endMin;
    commit(next);
  }

  function addBlock() {
    const normalized = normalizeSchedule(getSchedule());
    const schedule = normalized.schedule;
    const blocks = schedule.blocks.map((block) => ({ ...block }));
    let startMin = 9 * 60;
    if (blocks.length > 0) {
      const base = blocks[blocks.length - 1];
      const candidate = clampEnd(snapMinutes(base.endMin));
      startMin = candidate >= MINUTES_IN_DAY ? 0 : candidate;
    }
    let endMin = clampEnd(snapMinutes(startMin + 60));
    if (endMin === startMin) endMin = clampEnd(startMin + STEP_MINUTES);
    const newBlock = { id: generateId(), startMin: clampStart(startMin), endMin };
    blocks.push(newBlock);

    const next = { ...schedule, blocks };
    next.startMin = blocks[0].startMin;
    next.endMin = blocks[0].endMin;
    selectedBlockId = newBlock.id;
    commit(next);
  }

  function removeBlock(blockId) {
    const normalized = normalizeSchedule(getSchedule());
    const schedule = normalized.schedule;
    if (schedule.blocks.length <= 1) return;
    const blocks = schedule.blocks.filter((block) => block.id !== blockId);
    if (!blocks.length) return;
    if (!blocks.some((block) => block.id === selectedBlockId)) {
      selectedBlockId = blocks[0].id;
    }
    const next = { ...schedule, blocks };
    next.startMin = blocks[0].startMin;
    next.endMin = blocks[0].endMin;
    commit(next);
  }

  function selectBlock(blockId) {
    if (!blockId) return;
    const normalized = normalizeSchedule(getSchedule());
    const schedule = normalized.schedule;
    if (!schedule.blocks.some((block) => block.id === blockId)) return;
    selectedBlockId = blockId;
    updateUI(schedule);
  }

  function toggleDay(day) {
    const normalized = normalizeSchedule(getSchedule());
    const schedule = normalized.schedule;
    const activeDays = new Set(schedule.days);
    if (activeDays.has(day)) {
      activeDays.delete(day);
    } else {
      activeDays.add(day);
    }
    if (activeDays.size === 0) activeDays.add(day);
    const next = { ...schedule, days: Array.from(activeDays).sort((a, b) => a - b) };
    commit(next);
  }

  function applyDayPreset(presetKey) {
    const days = DAY_PRESETS[presetKey];
    if (!days) return;
    const normalized = normalizeSchedule(getSchedule());
    const schedule = normalized.schedule;
    const next = { ...schedule, days: days.slice() };
    commit(next);
  }

  function setupDrag(el, isStart) {
    if (!el || !UI.trackWrapper) return;
    el.onmousedown = (e) => {
      e.preventDefault();
      const move = (me) => {
        const rect = UI.trackWrapper.getBoundingClientRect();
        let pct = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
        let mins = snapMinutes(pct * MINUTES_IN_DAY);
        mins = isStart ? clampStart(mins) : clampEnd(mins);
        updateSelectedBlockTime(isStart, mins);
      };

      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        persist(normalizeSchedule(getSchedule()).schedule);
      };

      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };
  }

  function bindTimeInput(input, isStart) {
    if (!input) return;
    const applyValue = () => {
      const minutes = parseTimeInput(input.value, !isStart);
      if (minutes === null) {
        updateUI();
        return;
      }
      updateSelectedBlockTime(isStart, minutes, true);
    };
    input.addEventListener('blur', applyValue);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      }
    });
  }

  function setup() {
    if (isBound) return;
    isBound = true;

    if (UI.scheduleToggle) {
      UI.scheduleToggle.addEventListener('change', (e) => {
        const normalized = normalizeSchedule(getSchedule());
        const schedule = normalized.schedule;
        const next = { ...schedule, scheduleActive: !!e.target.checked };
        commit(next);
      });
    }

    if (UI.dayButtons) {
      UI.dayButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const day = Number(btn.dataset.day);
          if (Number.isInteger(day)) toggleDay(day);
        });
      });
    }

    if (UI.dayPresetButtons) {
      UI.dayPresetButtons.forEach((btn) => {
        btn.addEventListener('click', () => {
          const presetKey = btn.dataset.dayPreset;
          applyDayPreset(presetKey);
        });
      });
    }

    if (UI.schedulePresets) {
      UI.schedulePresets.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-start][data-end]');
        if (!btn) return;
        const start = Number(btn.dataset.start);
        const end = Number(btn.dataset.end);
        if (!Number.isFinite(start) || !Number.isFinite(end)) return;
        applyPreset(start, end);
      });
    }

    if (UI.addBlockBtn) {
      UI.addBlockBtn.addEventListener('click', () => addBlock());
    }

    if (UI.blockList) {
      UI.blockList.addEventListener('click', (e) => {
        const actionEl = e.target.closest('[data-action][data-block-id]');
        if (!actionEl) return;
        const blockId = actionEl.dataset.blockId;
        const action = actionEl.dataset.action;
        if (action === 'remove-block') removeBlock(blockId);
        if (action === 'select-block') selectBlock(blockId);
      });
    }

    if (UI.sliderBlocks) {
      UI.sliderBlocks.addEventListener('click', (e) => {
        const target = e.target.closest('[data-block-id]');
        if (!target) return;
        selectBlock(target.dataset.blockId);
      });
    }

    bindTimeInput(UI.startInput, true);
    bindTimeInput(UI.endInput, false);

    setupDrag(UI.handleStart, true);
    setupDrag(UI.handleEnd, false);
  }

  function display() {
    setup();
    updateUI();
  }

  return { setup, display };
}
