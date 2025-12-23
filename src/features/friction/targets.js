import observerHub from '../../shared/dom/ObserverHub.js';

export function markElement(el, attr, overlayExemptSelector) {
  if (!(el instanceof Element)) return;
  // 복잡한 closest 체크는 꼭 필요할 때만
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
  if (!selector || !(node instanceof Element)) return;

  // [수정] 무조건적인 querySelectorAll을 제거합니다.
  // 추가된 노드 자체가 타겟(이미지/비디오 등)인지, 
  // 혹은 타겟을 감싸는 주요 컨테이너(트윗 article 등)인지만 체크합니다.
  
  if (node.matches(selector)) {
    markElement(node, attr, overlayExemptSelector);
  }
  
  // X의 경우, 트윗 덩어리(article)가 들어올 때 그 안에 이미지가 있을 확률이 높으므로
  // 아주 제한적으로만 탐색하거나, CSS에 전적으로 맡깁니다.
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
