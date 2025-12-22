const NudgeGame = (() => {
  const DEFAULT_CONFIG = {
    spriteSizePx: 96,
    baseSpeedPxPerSec: 140,
    spawnIntervalMs: 4000,
    maxSprites: 6,
    speedRamp: 1.15,
    asset: {
      gifPath: 'samples/images/nudge-object.gif',
      audioPath: 'samples/sounds/nudge-music.mp3',
      label: 'nudge-object',
    },
    message: {
      title: '잠깐!',
      body: '오늘 너무 이에 시간 있는 거 같아. 잠깐 쉬고 갈래?',
    },
  };

  let config = DEFAULT_CONFIG;
  let mode = 'auto';
  let root = null;
  let shadow = null;
  let layer = null;
  let sprites = [];
  let rafId = null;
  let lastTs = null;
  let spawnTimer = null;
  let modalOpen = false;
  let audio = null;
  let audioFadeToken = 0;
  let pendingAudioUnlock = false;

  function clamp(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.max(min, Math.min(max, x));
  }

  function mergeConfig(partial) {
    const src = partial && typeof partial === 'object' ? partial : {};
    const merged = {
      ...DEFAULT_CONFIG,
      ...src,
      asset: {
        ...DEFAULT_CONFIG.asset,
        ...(src.asset && typeof src.asset === 'object' ? src.asset : {}),
      },
      message: {
        ...DEFAULT_CONFIG.message,
        ...(src.message && typeof src.message === 'object' ? src.message : {}),
      },
    };

    merged.spriteSizePx = clamp(merged.spriteSizePx, 32, 260);
    merged.baseSpeedPxPerSec = clamp(merged.baseSpeedPxPerSec, 20, 1200);
    merged.spawnIntervalMs = clamp(merged.spawnIntervalMs, 200, 30_000);
    merged.maxSprites = Math.round(clamp(merged.maxSprites, 1, 40));
    merged.speedRamp = clamp(merged.speedRamp, 1.0, 3.0);
    return merged;
  }

  function ensureRoot() {
    if (root && shadow && layer) return;
    root = document.createElement('div');
    root.id = 'friction-nudge-root';
    root.style.position = 'fixed';
    root.style.inset = '0';
    root.style.zIndex = '2147483647';
    root.style.pointerEvents = 'none';

    shadow = root.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
            <style>
                :host { all: initial; }
                .layer { position: fixed; inset: 0; pointer-events: none; }
                .sprite {
                    position: fixed;
                    left: 0;
                    top: 0;
                    width: 96px;
                    height: 96px;
                    pointer-events: auto;
                    user-select: none;
                    -webkit-user-drag: none;
                    will-change: transform;
                    cursor: pointer;
                    filter: drop-shadow(0 10px 20px rgba(0,0,0,0.22));
                }
                .modal-backdrop {
                    position: fixed;
                    inset: 0;
                    background: rgba(15, 23, 42, 0.55);
                    backdrop-filter: blur(6px);
                    pointer-events: auto;
                    display: none;
                    align-items: center;
                    justify-content: center;
                    padding: 20px;
                }
                .modal-backdrop.is-open { display: flex; }
                .modal {
                    width: min(520px, 92vw);
                    background: rgba(255,255,255,0.92);
                    color: #0f172a;
                    border: 1px solid rgba(226, 232, 240, 0.9);
                    border-radius: 18px;
                    box-shadow: 0 22px 55px rgba(0,0,0,0.25);
                    padding: 18px 18px 16px;
                    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Apple SD Gothic Neo, 'Noto Sans KR', sans-serif;
                }
                .modal h3 { margin: 0 0 6px; font-size: 18px; }
                .modal p { margin: 0 0 14px; color: rgba(15,23,42,0.72); line-height: 1.45; }
                .actions { display: flex; gap: 10px; justify-content: flex-end; flex-wrap: wrap; }
                .btn {
                    border: 1px solid rgba(148, 163, 184, 0.35);
                    background: rgba(255,255,255,0.9);
                    color: #0f172a;
                    padding: 10px 14px;
                    border-radius: 12px;
                    font-weight: 700;
                    cursor: pointer;
                }
                .btn.primary {
                    background: #6366f1;
                    color: #fff;
                    border-color: transparent;
                }
                .btn:focus-visible { outline: 3px solid rgba(99, 102, 241, 0.35); outline-offset: 2px; }
            </style>
            <div class="layer"></div>
            <div class="modal-backdrop" id="nudgeModalBackdrop" role="dialog" aria-modal="true" aria-label="집중 안내">
                <div class="modal">
                    <h3 id="nudgeTitle"></h3>
                    <p id="nudgeBody"></p>
                    <div class="actions">
                        <button class="btn" id="nudgeContinueBtn" type="button">계속하기</button>
                        <button class="btn primary" id="nudgeLeaveBtn" type="button">대시보드 이동</button>
                    </div>
                </div>
            </div>
            <audio id="nudgeBgm" preload="auto" loop></audio>
        `;

    layer = shadow.querySelector('.layer');
    audio = shadow.getElementById('nudgeBgm');

    const backdrop = shadow.getElementById('nudgeModalBackdrop');
    const btnContinue = shadow.getElementById('nudgeContinueBtn');
    const btnLeave = shadow.getElementById('nudgeLeaveBtn');

    btnContinue?.addEventListener('click', () => {
      ackAndStop();
    });
    btnLeave?.addEventListener('click', () => {
      navigateToDashboard();
    });
    backdrop?.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        ackAndStop();
      }
    });

    document.documentElement.appendChild(root);
  }

  function setModalOpen(isOpen) {
    modalOpen = isOpen;
    const backdrop = shadow?.getElementById('nudgeModalBackdrop');
    if (backdrop) backdrop.classList.toggle('is-open', !!isOpen);
    if (isOpen) {
      shadow?.getElementById('nudgeLeaveBtn')?.focus?.();
    }
  }

  function setModalText(title, body) {
    const t = shadow?.getElementById('nudgeTitle');
    const b = shadow?.getElementById('nudgeBody');
    if (t) t.textContent = title || DEFAULT_CONFIG.message.title;
    if (b) b.textContent = body || DEFAULT_CONFIG.message.body;
  }

  function applyAudioSource() {
    if (!audio) return;
    const src = config?.asset?.audioPath ? chrome.runtime.getURL(config.asset.audioPath) : '';
    if (!src) return;
    if (audio.getAttribute('src') !== src) {
      audio.pause();
      audio.currentTime = 0;
      audio.setAttribute('src', src);
      audio.load();
    }
    audio.volume = 0;
  }

  function fadeAudioTo(targetVolume, { pauseAtEnd = false } = {}) {
    const a = audio;
    if (!a) return;
    const token = ++audioFadeToken;
    const from = clamp(a.volume, 0, 1);
    const to = clamp(targetVolume, 0, 1);
    const duration = 180;
    const start = performance.now();

    if (to > 0 && a.paused) {
      a.play()
        .then(() => {
          pendingAudioUnlock = false;
        })
        .catch(() => {
          pendingAudioUnlock = true;
        });
    }

    function step(now) {
      if (token !== audioFadeToken) return;
      const t = Math.min(1, (now - start) / duration);
      const next = clamp(from + (to - from) * t, 0, 1);
      a.volume = next;
      if (t < 1) requestAnimationFrame(step);
      else if (pauseAtEnd && to === 0) a.pause();
    }

    requestAnimationFrame(step);
  }

  function randomVelocity(speed) {
    const angle = Math.random() * Math.PI * 2;
    return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
  }

  function updateSpriteSize(sprite) {
    const size = `${config.spriteSizePx}px`;
    sprite.el.style.width = size;
    sprite.el.style.height = size;
  }

  function spawnOne() {
    ensureRoot();
    if (!layer) return;
    if (sprites.length >= config.maxSprites) return;

    const el = document.createElement('img');
    el.className = 'sprite';
    el.alt = config?.asset?.label || 'nudge';
    el.dataset.frictionFallbackStep = '0';
    el.src = chrome.runtime.getURL(config.asset.gifPath);
    el.addEventListener('error', () => {
      const step = parseInt(el.dataset.frictionFallbackStep || '0', 10) || 0;
      if (step === 0 && config.asset.gifPath !== 'samples/images/nudge-object.gif') {
        el.dataset.frictionFallbackStep = '1';
        el.src = chrome.runtime.getURL('samples/images/nudge-object.gif');
        return;
      }
      if (step <= 1) {
        el.dataset.frictionFallbackStep = '2';
        el.src = chrome.runtime.getURL('samples/images/rat-dance.gif');
      }
    });
    el.decoding = 'async';
    updateSpriteSize({ el });

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const size = config.spriteSizePx;

    const x = Math.random() * Math.max(1, vw - size);
    const y = Math.random() * Math.max(1, vh - size);

    const speed = config.baseSpeedPxPerSec * (sprites.length === 0 ? 1 : Math.pow(config.speedRamp, sprites.length * 0.5));
    const vel = randomVelocity(speed);

    const sprite = { el, x, y, vx: vel.vx, vy: vel.vy };

    el.addEventListener('click', () => {
      setModalText(config.message.title, config.message.body);
      setModalOpen(true);
      if (pendingAudioUnlock) fadeAudioTo(0.85);
    });

    layer.appendChild(el);
    sprites.push(sprite);
    el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  }

  function speedUpAll() {
    for (const s of sprites) {
      s.vx *= config.speedRamp;
      s.vy *= config.speedRamp;
    }
  }

  function startSpawner() {
    if (spawnTimer) clearInterval(spawnTimer);
    spawnTimer = setInterval(() => {
      if (modalOpen) return;
      if (sprites.length < config.maxSprites) {
        spawnOne();
        speedUpAll();
      }
    }, config.spawnIntervalMs);
  }

  function stopSpawner() {
    if (!spawnTimer) return;
    clearInterval(spawnTimer);
    spawnTimer = null;
  }

  function loop(ts) {
    if (!root) return;
    if (lastTs === null) lastTs = ts;
    const dt = Math.min(0.05, (ts - lastTs) / 1000);
    lastTs = ts;

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const size = config.spriteSizePx;

    for (const s of sprites) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;

      if (s.x <= 0) {
        s.x = 0;
        s.vx = Math.abs(s.vx);
      }
      if (s.y <= 0) {
        s.y = 0;
        s.vy = Math.abs(s.vy);
      }
      if (s.x >= vw - size) {
        s.x = vw - size;
        s.vx = -Math.abs(s.vx);
      }
      if (s.y >= vh - size) {
        s.y = vh - size;
        s.vy = -Math.abs(s.vy);
      }

      s.el.style.transform = `translate3d(${Math.round(s.x)}px, ${Math.round(s.y)}px, 0)`;
    }

    rafId = requestAnimationFrame(loop);
  }

  function startLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    lastTs = null;
    rafId = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = null;
    lastTs = null;
  }

  function ackAndStop() {
    stop();
  }

  function navigateToDashboard() {
    stop();
    try {
      window.location.href = chrome.runtime.getURL('pages/dashboard.html');
    } catch (_) {}
  }

  function start(nextConfig) {
    config = mergeConfig(nextConfig);
    mode = nextConfig && typeof nextConfig === 'object' && nextConfig.__mode === 'debug' ? 'debug' : 'auto';
    ensureRoot();
    applyAudioSource();
    setModalOpen(false);

    if (sprites.length === 0) spawnOne();
    startSpawner();
    startLoop();

    fadeAudioTo(0.65);
  }

  function stop() {
    stopSpawner();
    stopLoop();
    sprites.forEach((s) => s.el.remove());
    sprites = [];
    if (audio) fadeAudioTo(0, { pauseAtEnd: true });
    if (root) root.remove();
    root = null;
    shadow = null;
    layer = null;
    audio = null;
    modalOpen = false;
    pendingAudioUnlock = false;
    mode = 'auto';
  }

  function setConfig(partial) {
    config = mergeConfig({ ...config, ...(partial && typeof partial === 'object' ? partial : {}) });
    for (const s of sprites) updateSpriteSize(s);
    startSpawner();
  }

  function spawn() {
    spawnOne();
  }

  function isActive() {
    return !!root;
  }

  function getMode() {
    return mode;
  }

  return { start, stop, setConfig, spawn, isActive, getMode };
})();

export default NudgeGame;
