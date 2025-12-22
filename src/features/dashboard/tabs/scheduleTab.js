export function createScheduleTab({ UI, getSchedule, setSchedule }) {
  let isBound = false;

  function minToTime(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (minutes === 1440) return '24:00';
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  function updateUI() {
    if (!UI.trackWrapper) return;
    const currentSchedule = getSchedule();

    const startPct = (currentSchedule.startMin / 1440) * 100;
    const endPct = (currentSchedule.endMin / 1440) * 100;

    UI.handleStart.style.left = `${startPct}%`;
    UI.handleEnd.style.left = `${endPct}%`;
    UI.sliderRange.style.left = `${startPct}%`;
    UI.sliderRange.style.width = `${endPct - startPct}%`;

    UI.displayStart.textContent = minToTime(currentSchedule.startMin);
    UI.displayEnd.textContent = minToTime(currentSchedule.endMin);
    UI.scheduleToggle.checked = currentSchedule.scheduleActive;

    UI.scheduleContainer.style.opacity = currentSchedule.scheduleActive ? '1' : '0.4';
    UI.scheduleContainer.style.pointerEvents = currentSchedule.scheduleActive ? 'auto' : 'none';
  }

  function persist(currentSchedule) {
    chrome.storage.local.set({ schedule: currentSchedule }, () => {
      chrome.runtime.sendMessage({ action: 'SCHEDULE_UPDATED' });
    });
  }

  function setupDrag(el, isStart) {
    el.onmousedown = (e) => {
      e.preventDefault();
      const move = (me) => {
        const rect = UI.trackWrapper.getBoundingClientRect();
        let pct = Math.max(0, Math.min(1, (me.clientX - rect.left) / rect.width));
        let mins = Math.round((pct * 1440) / 10) * 10;

        const currentSchedule = { ...getSchedule() };
        if (isStart) {
          currentSchedule.startMin = Math.min(mins, currentSchedule.endMin - 10);
        } else {
          currentSchedule.endMin = Math.max(mins, currentSchedule.startMin + 10);
        }

        setSchedule(currentSchedule);
        updateUI();
      };

      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        persist(getSchedule());
      };

      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    };
  }

  function setup() {
    if (isBound) return;
    isBound = true;

    if (UI.scheduleToggle) {
      UI.scheduleToggle.addEventListener('change', (e) => {
        const next = { ...getSchedule(), scheduleActive: !!e.target.checked };
        setSchedule(next);
        updateUI();
        persist(next);
      });
    }

    if (UI.handleStart) setupDrag(UI.handleStart, true);
    if (UI.handleEnd) setupDrag(UI.handleEnd, false);
  }

  function display() {
    setup();
    updateUI();
  }

  return { setup, display };
}

