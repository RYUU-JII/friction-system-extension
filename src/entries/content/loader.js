(() => {
  try {
    const url = chrome?.runtime?.getURL
      ? chrome.runtime.getURL('entries/content/index.js')
      : 'entries/content/index.js';
    import(url).catch((err) => {
      console.error('Failed to load content module:', err);
    });
  } catch (err) {
    console.error('Failed to initialize content loader:', err);
  }
})();
