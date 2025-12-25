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

export function sendBehaviorEvent(name, payload = {}) {
  const event = {
    name,
    ts: Date.now(),
    ...(payload && typeof payload === 'object' ? payload : {}),
  };
  safeSendMessage({ type: 'TRACK_BEHAVIOR_EVENT', event });
}
