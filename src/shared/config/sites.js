const BASE_SELECTORS = {
  visualTargets:
    ':is(img, picture, canvas, svg, [role="img"], [data-testid="tweetPhoto"] [style*="background-image"], [style*="background-image"]:not(:has(img, video, canvas, svg)), #thumbnail img, [id="thumbnail"] img, .thumbnail img, .thumb img, [class*="thumbnail"] img, [class*="thumb"] img, ytd-thumbnail img, ytd-rich-grid-media img, ytd-compact-video-renderer img, ytd-reel-video-renderer img)',
  visualVideoTargets: 'video',
  interactiveTargets:
    ':is(a, button, article, [onclick], input[type="submit"], input[type="image"], [tabindex]:not([tabindex="-1"]), [role="button"], [role="link"], [role="article"], [role="menuitem"], [role="option"], [role="tab"], [class*="link"], [class*="button"], [class*="btn"], figure):not(.stickyunit)',
  textLayoutTargets: ':is(p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, a, span[role="text"])',
  textVisualTargets:
    ':is(span:not([role]), span[role="text"], a:not(:has(img, video, canvas, svg)), p:not(:has(img, video, canvas, svg)), li:not(:has(img, video, canvas, svg)), h1:not(:has(img, video, canvas, svg)), h2:not(:has(img, video, canvas, svg)), h3:not(:has(img, video, canvas, svg)), h4:not(:has(img, video, canvas, svg)), h5:not(:has(img, video, canvas, svg)), h6:not(:has(img, video, canvas, svg)), blockquote:not(:has(img, video, canvas, svg)))',
  textTargets: ':is(p, li, h1, h2, h3, h4, h5, h6, blockquote, td, th, a, span[role="text"])',
  overlayExempt: ':is([role="dialog"], [aria-modal="true"])',
  textShuffleExcludedClosest: [
    'script',
    'style',
    'noscript',
    'textarea',
    'input',
    'select',
    'option',
    'pre',
    'code',
    'svg',
    'math',
    '[contenteditable="true"]',
    '[contenteditable=""]',
  ].join(', '),
  hoverReveal: {
    mediaStackImage: ':is(img, picture, canvas)',
    mediaStackBackground: ':is([style*="background-image"])',
    mediaStackRoleImg: ':is(svg, [role="img"])',
    mediaStackFallback: 'img, picture, canvas, svg, video, [role="img"], [style*="background-image"]',
    twitterPhotoScope: '[data-testid="tweetPhoto"]',
    videoHoverScope: '[data-friction-video-hover-scope="1"]',
  },
  interaction: {
    inputSubmit: 'input[type="submit"]',
    inputImage: 'input[type="image"]',
  },
  instagram: {
    postLink: 'a[href*="/p/"]',
    gridMedia: 'img, video',
    gridOverlayIcons:
      'svg[aria-label*="ì¢‹ì•„??], svg[aria-label*="?“ê?"], svg[aria-label*="like"], svg[aria-label*="comment"]',
    buttonOrLink: 'button,[role="button"],a,[role="link"]',
    deepLabel: 'svg[aria-label], span[aria-label]',
    deepLabelScan:
      'svg[aria-label], span[aria-label], [aria-label][role="img"], [aria-label][role="button"], [aria-label][role="link"], button[aria-label], a[aria-label]',
    time: 'time[datetime]',
  },
};

const YOUTUBE_SELECTORS = {
  hoverRevealScope: [
    'ytd-rich-grid-media',
    'ytd-rich-item-renderer',
    'ytd-video-renderer',
    'ytd-grid-video-renderer',
    'ytd-compact-video-renderer',
    'ytd-playlist-video-renderer',
    'ytd-reel-video-renderer',
    'ytd-reel-item-renderer',
    'ytd-thumbnail',
    '#thumbnail',
    '[id="thumbnail"]',
  ].join(', '),
  socialMetrics: {
    engagement: [
      '#vote-count-middle',
      'ytd-comment-action-buttons-renderer #vote-count-middle',
      'ytd-toggle-button-renderer #text',
      'ytd-segmented-like-dislike-button-renderer #text',
      '.yt-spec-button-shape-next__button-text-content',
    ],
    exposure: [
      'ytd-video-view-count-renderer span.style-scope.yt-formatted-string',
      'ytd-watch-metadata #info-strings yt-formatted-string',
      'ytd-watch-metadata #info-strings span.style-scope.yt-formatted-string',
      'ytd-video-meta-block #metadata-line span',
      'ytd-video-renderer #metadata-line span',
      'ytd-compact-video-renderer #metadata-line span',
      'ytd-rich-grid-media #metadata-line span',
      'ytd-grid-video-renderer #metadata-line span',
      'ytd-playlist-video-renderer #metadata-line span',
      'span.yt-core-attributed-string.yt-content-metadata-view-model__metadata-text',
      '.ytp-modern-videowall-still-view-count-and-date-info',
    ],
  },
};

const X_SELECTORS = {
  tweet: '[data-testid="tweet"]',
  socialMetrics: {
    engagement: [
      '[data-testid="like"] span',
      '[data-testid="retweet"] span',
      '[data-testid="reply"] span',
      '[data-testid="quoteTweet"] span',
      '[data-testid="bookmark"] span',
    ],
    exposure: ['[data-testid="viewCount"] span', 'a[href*="/analytics"] span'],
  },
};

const INSTAGRAM_SELECTORS = {
  socialMetrics: {
    engagement: [
      'span[role="button"][tabindex="0"]',
      'article span[role="button"][tabindex="0"]',
      'section[role="dialog"] span[role="button"][tabindex="0"]',
      'div[role="dialog"] span[role="button"][tabindex="0"]',
      'a[href*="/liked_by/"] span',
      'a[href*="/likes/"] span',
      'a[href*="/comments/"] span',
      'header a[href*="/followers/"] span',
      'header a[href*="/following/"] span',
    ],
    exposure: [
      'time[datetime]',
      'article time[datetime]',
      'section[role="dialog"] time[datetime]',
      'div[role="dialog"] time[datetime]',
      'a[href*="/reel/"] span',
      'a[href*="/reels/"] span',
    ],
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
  return { ...BASE_SELECTORS, ...(site.selectors || {}) };
}

