export function applyMockPreviewState(root, settings) {
  const blur = settings?.blur?.isActive ? String(settings.blur.value) : '0px';
  const saturation = settings?.saturation?.isActive ? String(settings.saturation.value) : '1';
  const letterSpacing = settings?.letterSpacing?.isActive ? String(settings.letterSpacing.value) : '0px';
  const textOpacity = settings?.textOpacity?.isActive ? String(settings.textOpacity.value) : '1';
  const textShadow = settings?.textShadow?.isActive ? String(settings.textShadow.value) : 'none';

  root.style.setProperty('--preview-media-blur', blur);
  root.style.setProperty('--preview-saturation', saturation);
  root.style.setProperty('--preview-letter-spacing', letterSpacing);
  root.style.setProperty('--preview-text-opacity', textOpacity);
  root.style.setProperty('--preview-text-shadow', textShadow);

  root.classList.toggle('hide-engagement', !!settings?.socialEngagement?.isActive);
  root.classList.toggle('hide-exposure', !!settings?.socialExposure?.isActive);
}

export const SETTINGS_PREVIEW_PLATFORMS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'x', label: 'X' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
];

export const MOCK_PLATFORM_DATA = {
  youtube: {
    title: '집중이 필요할 때 틀어두는 영상',
    channel: 'Focus Channel',
    views: '조회수 1.2만회',
    age: '2일 전',
    likes: '좋아요 2.3천',
    duration: '12:34',
  },
  x: {
    name: 'Momentum',
    handle: '@momentum',
    time: '1시간 전',
    metrics: {
      replies: '답글 48',
      reposts: '리포스트 112',
      likes: '좋아요 1,204',
      views: '조회 8.2K',
    },
  },
  instagram: {
    user: 'momentum',
    time: '3시간 전',
    likes: '좋아요 9,201',
    actionsLabel: '좋아요 · 댓글 · 공유',
  },
  tiktok: {
    metrics: {
      likes: '좋아요 43.1K',
      comments: '댓글 1,204',
      shares: '공유 8,912',
      views: '조회 210K',
    },
  },
  defaults: {
    captionFallback: '오늘은 집중을 위해 필터를 조금만 세게 해볼까?',
  },
};

export function normalizeSettingsPreviewPlatformId(raw) {
  const id = String(raw || '').trim().toLowerCase();
  if (SETTINGS_PREVIEW_PLATFORMS.some((p) => p.id === id)) return id;
  return SETTINGS_PREVIEW_PLATFORMS[0]?.id || 'youtube';
}

export function takePreviewLines(raw, maxLines = 4) {
  const lines = String(raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.slice(0, Math.max(1, maxLines)).join('\n');
}

export function applySettingsPreviewText(root, text) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const nextText = String(text ?? '');
  root.querySelectorAll('[data-mock-dynamic-text=\"true\"]').forEach((node) => {
    node.textContent = nextText;
  });
}

function createMockMetric(text, kind) {
  const el = document.createElement('span');
  el.className = `mock-metric mock-textish mock-metric-${kind}`;
  el.textContent = text;
  return el;
}

function createMediaImg({ className, alt, src, decoding = 'async' }) {
  const img = document.createElement('img');
  img.className = `mock-media ${className || ''}`.trim();
  img.decoding = decoding;
  img.alt = alt || '';
  img.src = src || '';
  return img;
}

function createMockYoutube({ variant, baseText, resolveAssetUrl }) {
  const data = MOCK_PLATFORM_DATA.youtube;
  const card = document.createElement('article');
  card.className = 'mock-item settings-surface-soft mock-video mock-youtube';

  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'mock-thumbnail-wrap';

  const img = createMediaImg({
    className: 'mock-thumbnail',
    alt: variant?.label ? String(variant.label) : 'thumbnail',
    src: resolveAssetUrl?.(variant?.url) || String(variant?.url || ''),
  });
  thumbWrap.appendChild(img);

  const badge = document.createElement('div');
  badge.className = 'mock-badge mock-badge-duration';
  badge.textContent = data.duration;
  thumbWrap.appendChild(badge);

  const meta = document.createElement('div');
  meta.className = 'mock-video-meta';

  const title = document.createElement('div');
  title.className = 'mock-title mock-textish';
  title.textContent = data.title;

  const sub = document.createElement('div');
  sub.className = 'mock-subtitle mock-textish';
  sub.appendChild(document.createTextNode(`${data.channel} · `));
  sub.appendChild(createMockMetric(data.views, 'exposure'));
  sub.appendChild(document.createTextNode(' · '));
  sub.appendChild(createMockMetric(data.age, 'exposure'));
  sub.appendChild(document.createTextNode(' · '));
  sub.appendChild(createMockMetric(data.likes, 'engagement'));

  const desc = document.createElement('div');
  desc.className = 'mock-youtube-desc mock-textish';
  desc.dataset.mockDynamicText = 'true';
  desc.textContent = baseText || MOCK_PLATFORM_DATA.defaults.captionFallback;

  meta.appendChild(title);
  meta.appendChild(sub);
  meta.appendChild(desc);

  card.appendChild(thumbWrap);
  card.appendChild(meta);
  return card;
}

function createMockX({ variant, postText, resolveAssetUrl }) {
  const data = MOCK_PLATFORM_DATA.x;
  const card = document.createElement('article');
  card.className = 'mock-item settings-surface-soft mock-post mock-x';

  const header = document.createElement('div');
  header.className = 'mock-post-header';

  const avatar = createMediaImg({
    className: 'mock-avatar',
    alt: 'profile',
    src: resolveAssetUrl?.(variant?.url) || String(variant?.url || ''),
  });

  const author = document.createElement('div');
  author.className = 'mock-post-author';

  const name = document.createElement('div');
  name.className = 'mock-author-name mock-textish';
  name.textContent = data.name;

  const meta = document.createElement('div');
  meta.className = 'mock-author-meta mock-textish';
  meta.appendChild(document.createTextNode(`${data.handle} · `));
  meta.appendChild(createMockMetric(data.time, 'exposure'));

  author.appendChild(name);
  author.appendChild(meta);

  header.appendChild(avatar);
  header.appendChild(author);

  const body = document.createElement('div');
  body.className = 'mock-post-body';

  const text = document.createElement('div');
  text.className = 'mock-text mock-textish';
  text.dataset.mockDynamicText = 'true';
  text.textContent = postText;

  const footer = document.createElement('div');
  footer.className = 'mock-post-footer mock-post-footer-x';
  footer.appendChild(createMockMetric(data.metrics.replies, 'engagement'));
  footer.appendChild(createMockMetric(data.metrics.reposts, 'engagement'));
  footer.appendChild(createMockMetric(data.metrics.likes, 'engagement'));
  footer.appendChild(createMockMetric(data.metrics.views, 'exposure'));

  body.appendChild(text);
  body.appendChild(footer);

  card.appendChild(header);
  card.appendChild(body);
  return card;
}

function createMockInstagram({ variant, captionText, resolveAssetUrl }) {
  const data = MOCK_PLATFORM_DATA.instagram;
  const card = document.createElement('article');
  card.className = 'mock-item settings-surface-soft mock-ig';

  const header = document.createElement('div');
  header.className = 'mock-ig-header';

  const avatar = createMediaImg({
    className: 'mock-avatar mock-ig-avatar',
    alt: 'profile',
    src: resolveAssetUrl?.(variant?.url) || String(variant?.url || ''),
  });

  const user = document.createElement('div');
  user.className = 'mock-ig-user';

  const name = document.createElement('div');
  name.className = 'mock-ig-name mock-textish';
  name.textContent = data.user;

  const time = document.createElement('div');
  time.className = 'mock-ig-time mock-textish';
  time.appendChild(createMockMetric(data.time, 'exposure'));

  user.appendChild(name);
  user.appendChild(time);

  header.appendChild(avatar);
  header.appendChild(user);

  const media = document.createElement('div');
  media.className = 'mock-ig-media';
  media.appendChild(
    createMediaImg({
      className: 'mock-ig-photo',
      alt: variant?.label ? String(variant.label) : 'post',
      src: resolveAssetUrl?.(variant?.url) || String(variant?.url || ''),
    })
  );

  const actions = document.createElement('div');
  actions.className = 'mock-ig-actions mock-textish';
  actions.textContent = data.actionsLabel;

  const likes = document.createElement('div');
  likes.className = 'mock-ig-likes mock-textish';
  likes.appendChild(createMockMetric(data.likes, 'engagement'));

  const caption = document.createElement('div');
  caption.className = 'mock-ig-caption mock-textish';
  caption.dataset.mockDynamicText = 'true';
  caption.textContent = captionText;

  card.appendChild(header);
  card.appendChild(media);
  card.appendChild(actions);
  card.appendChild(likes);
  card.appendChild(caption);
  return card;
}

function createMockTikTok({ variant, captionText, resolveAssetUrl }) {
  const data = MOCK_PLATFORM_DATA.tiktok;
  const card = document.createElement('article');
  card.className = 'mock-item settings-surface-soft mock-tiktok';

  const stage = document.createElement('div');
  stage.className = 'mock-tiktok-stage';
  stage.appendChild(
    createMediaImg({
      className: 'mock-tiktok-video',
      alt: variant?.label ? String(variant.label) : 'video',
      src: resolveAssetUrl?.(variant?.url) || String(variant?.url || ''),
    })
  );

  const caption = document.createElement('div');
  caption.className = 'mock-tiktok-caption mock-textish';
  caption.dataset.mockDynamicText = 'true';
  caption.textContent = captionText;
  stage.appendChild(caption);

  const rail = document.createElement('div');
  rail.className = 'mock-tiktok-rail';
  rail.appendChild(createMockMetric(data.metrics.likes, 'engagement'));
  rail.appendChild(createMockMetric(data.metrics.comments, 'engagement'));
  rail.appendChild(createMockMetric(data.metrics.shares, 'engagement'));
  rail.appendChild(createMockMetric(data.metrics.views, 'exposure'));

  stage.appendChild(rail);
  card.appendChild(stage);
  return card;
}

function renderPlatformContent(platformId, { variant, baseText, resolveAssetUrl }) {
  const normalized = normalizeSettingsPreviewPlatformId(platformId);
  const captionText = baseText || MOCK_PLATFORM_DATA.defaults.captionFallback;

  switch (normalized) {
    case 'youtube':
      return createMockYoutube({ variant, baseText: captionText, resolveAssetUrl });
    case 'instagram':
      return createMockInstagram({ variant, captionText, resolveAssetUrl });
    case 'tiktok':
      return createMockTikTok({ variant, captionText, resolveAssetUrl });
    case 'x':
    default:
      return createMockX({ variant, postText: captionText, resolveAssetUrl });
  }
}

export function createSettingsPreviewMockWindow({
  platformId,
  variant,
  baseText,
  settings,
  focusCategory,
  resolveAssetUrl,
} = {}) {
  const root = document.createElement('div');
  root.className = 'preview-window';
  root.dataset.platform = normalizeSettingsPreviewPlatformId(platformId);
  if (focusCategory) root.dataset.focus = String(focusCategory);

  const content = document.createElement('div');
  content.className = 'preview-window-content';
  content.appendChild(renderPlatformContent(platformId, { variant, baseText, resolveAssetUrl }));

  root.appendChild(content);
  applyMockPreviewState(root, settings);
  return root;
}
