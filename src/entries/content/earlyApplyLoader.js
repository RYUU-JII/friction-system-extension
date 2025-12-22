(() => {
  try {
    const url = chrome?.runtime?.getURL
      ? chrome.runtime.getURL('entries/content/earlyApply.js')
      : 'entries/content/earlyApply.js';
    import(url).catch((err) => {
      console.error('Failed to load earlyApply module:', err);
    });
  } catch (err) {
    console.error('Failed to initialize earlyApply loader:', err);
  }
})();
