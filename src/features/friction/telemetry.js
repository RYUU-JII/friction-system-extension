export function safeSendMessage(message) {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
    return;
  }

  try {
    chrome.runtime.sendMessage(message, () => {
      if (chrome.runtime.lastError) {
        // ignore invalidated contexts
      }
    });
  } catch (_) {
    // ignore
  }
}

export function sendAnxietyMetric(metric) {
  safeSendMessage({ type: 'TRACK_ANXIETY', metric });
}
