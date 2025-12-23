/* src/shared/config/sites.js */

const BASE_SELECTORS = {
  // 1. 개별 타겟: 가장 기본적이고 가벼운 태그들 위주로 구성 (JS 부하 감소)
  visualTargets: ':is(article, main, section, figure, [role="article"], [role="main"])',
  visualVideoTargets: 'video',

  // 2. 인터랙티브 요소 (기존 유지)
  interactiveTargets:
    ':is(a, button, article, [onclick], input[type="submit"], [role="button"], [role="link"], [role="article"])',
  
  textLayoutTargets: ':is(p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, a, span[role="text"])',
  
  textVisualTargets:
    ':is(span:not([role]), span[role="text"], a:not(:has(img, video)), p:not(:has(img, video)), li:not(:has(img, video)))',
  
  textTargets: ':is(p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, a, span[role="text"])',
  
  overlayExempt: ':is([role="dialog"], [aria-modal="true"])',

  textShuffleExcludedClosest: [
    'script', 'style', 'noscript', 'textarea', 'input', 'select', 'option', 'pre', 'code', 'svg', 'math',
    '[contenteditable="true"]', '[contenteditable=""]',
  ].join(', '),

  interaction: {
    inputSubmit: 'input[type="submit"]',
    inputImage: 'input[type="image"]',
  },
};

// YouTube 최적화: 썸네일 덩어리들을 타겟으로 잡아 하위 요소를 한꺼번에 제어
const YOUTUBE_SELECTORS = {
  visualTargets: ':is(ytd-thumbnail, #thumbnail, ytd-rich-grid-media, ytd-video-renderer, ytd-grid-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-reel-item-renderer, ytd-reel-video-renderer, .ytp-videowall-still)',
  socialMetrics: {
    engagement: [
      '#vote-count-middle',
      '.yt-spec-button-shape-next__button-text-content',
    ],
    exposure: [
      'ytd-video-view-count-renderer span',
      'ytd-video-meta-block #metadata-line span',
      '.yt-core-attributed-string--link-inherit-color',
    ],
  },
};

// X(Twitter) 최적화: 트윗(article) 단위를 타겟으로 지정하여 자식 탐색 제거
const X_SELECTORS = {
  // 개별 이미지가 아니라 '트윗 덩어리'를 마킹합니다. 
  // 이미지 로딩 전에도 부모는 존재하므로 딜레이가 사라집니다.
  visualTargets: ':is(article, [data-testid="tweet"], [data-testid="tweetPhoto"])',
  
  socialMetrics: {
    engagement: [
      '[data-testid="like"] span',
      '[data-testid="retweet"] span',
      '[data-testid="reply"] span',
    ],
    exposure: ['[data-testid="viewCount"] span', 'a[href*="/analytics"] span'],
  },
};

const INSTAGRAM_SELECTORS = {
  // 인스타그램 포스트 전체를 타겟팅
  visualTargets: ':is(article, section[role="dialog"], div[role="dialog"])',
  socialMetrics: {
    engagement: [
      'a[href*="/liked_by/"] span',
      'a[href*="/likes/"] span',
    ],
    exposure: ['time[datetime]'],
  },
};

export const SITE_CONFIG = {
  default: {
    hostnames: [],
    selectors: BASE_SELECTORS,
  },
  youtube: {
    hostnames: ['youtube.com'],
    selectors: YOUTUBE_SELECTORS,
  },
  x: {
    hostnames: ['x.com', 'twitter.com'],
    selectors: X_SELECTORS,
  },
  instagram: {
    hostnames: ['instagram.com'],
    selectors: INSTAGRAM_SELECTORS,
  },
};

function normalizeHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  return host.replace(/^www\./, '');
}

function matchesHost(host, candidates) {
  if (!host) return false;
  return candidates.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

export function getSiteConfig(hostname) {
  const host = normalizeHost(hostname);
  if (!host) return SITE_CONFIG.default;

  const entries = Object.entries(SITE_CONFIG).filter(([key]) => key !== 'default');
  for (const [, config] of entries) {
    if (matchesHost(host, config.hostnames || [])) return config;
  }

  return SITE_CONFIG.default;
}

export function getSiteSelectors(hostname) {
  const site = getSiteConfig(hostname);
  // 사이트별 셀렉터가 있으면 BASE_SELECTORS를 덮어씁니다.
  return { ...BASE_SELECTORS, ...(site.selectors || {}) };
}
