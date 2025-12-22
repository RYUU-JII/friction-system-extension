import observerHub from '../../shared/dom/ObserverHub.js';

export function markElement(el, attr, overlayExemptSelector) {
  if (!(el instanceof Element)) return;
  if (overlayExemptSelector && el.closest(overlayExemptSelector)) return;
  if (attr) el.setAttribute(attr, '1');
}

export function markExisting(selector, attr, overlayExemptSelector) {
  if (!selector) return;
  let nodes = [];
  try {
    nodes = document.querySelectorAll(selector);
  } catch (_) {
    return;
  }

  for (const el of nodes) {
    markElement(el, attr, overlayExemptSelector);
  }
}

export function markNodeTree(node, selector, attr, overlayExemptSelector) {
  if (!selector) return;
  if (!(node instanceof Element)) return;

  try {
    if (node.matches(selector)) markElement(node, attr, overlayExemptSelector);
  } catch (_) {}

  let matches = [];
  try {
    matches = node.querySelectorAll(selector);
  } catch (_) {
    return;
  }

  for (const el of matches) {
    markElement(el, attr, overlayExemptSelector);
  }
}

export function subscribeToTargetChanges({ selector, attr, overlayExemptSelector, options }) {
  if (!selector || !attr) return () => {};
  const opts = options || { childList: true, subtree: true };

  return observerHub.subscribe(
    ({ addedNodes }) => {
      for (const node of addedNodes) {
        markNodeTree(node, selector, attr, overlayExemptSelector);
      }
    },
    opts
  );
}
