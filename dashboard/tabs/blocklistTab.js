export function createBlocklistTab({ UI, getState, onToggleBlockDomain }) {
  function normalizeDomain(raw) {
    return String(raw || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split('/')[0]
      .split('?')[0]
      .split('#')[0];
  }

  function display() {
    if (!UI.blockedListDisplay) return;
    const { currentBlockedUrls } = getState();

    UI.blockedListDisplay.innerHTML = '';

    if (!Array.isArray(currentBlockedUrls) || currentBlockedUrls.length === 0) {
      const li = document.createElement('li');
      li.className = 'is-empty';
      li.textContent = '차단된 사이트가 없습니다.';
      UI.blockedListDisplay.appendChild(li);
      return;
    }

    currentBlockedUrls.forEach((url) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${url}</span> <button class="list-block-btn is-blocked" data-url="${url}">해제</button>`;
      UI.blockedListDisplay.appendChild(li);
    });
  }

  function setup() {
    if (UI.addBlockBtn && UI.newBlockUrlInput) {
      UI.addBlockBtn.addEventListener('click', () => {
        const url = normalizeDomain(UI.newBlockUrlInput.value);
        if (!url) return;
        onToggleBlockDomain(url);
        UI.newBlockUrlInput.value = '';
      });

      UI.newBlockUrlInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        UI.addBlockBtn.click();
      });
    }

    if (UI.blockedListDisplay) {
      UI.blockedListDisplay.addEventListener('click', (e) => {
        const btn = e.target instanceof Element ? e.target.closest('.list-block-btn') : null;
        if (!btn || !UI.blockedListDisplay.contains(btn)) return;
        const url = btn.dataset.url;
        if (url) onToggleBlockDomain(url);
      });
    }
  }

  return { setup, display };
}

