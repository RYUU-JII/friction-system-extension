import observerHub from '../../shared/dom/ObserverHub.js';
import { getSiteSelectors } from '../../shared/config/sites.js';

const CONFIG = {
  // Policy: credits recharge with watch time
  secondsPerSkip: 180, // 3 min
  maxSkips: 3,

  // Forward seek guard
  minForwardJumpSec: 4,
  cooldownMs: 10_000,
  userGestureWindowMs: 1200,
  maxChargeDeltaSec: 2.5,

  // UI
  indicatorIdleOpacity: 0.4,
  indicatorPulseMs: 2200,
  speedModeMinIntervalMs: 2500,
  speedModeAutoHideMs: 6500,
};

function clamp(n, min, max) {
  const x = Number(n);
  if (!Number.isFinite(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function isFinitePositive(n) {
  return Number.isFinite(n) && n > 0;
}

function formatSeconds(sec) {
  const s = Math.max(0, Math.ceil(sec || 0));
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return r ? `${m}m ${r}s` : `${m}m`;
  }
  return `${s}s`;
}

const VideoSkipManager = {
  _active: false,
  _observerUnsub: null,
  _states: new WeakMap(),
  _videos: new Set(),

  _lastUserGestureTs: 0,
  _boundOnUserGesture: null,
  _boundOnFullscreenChange: null,

  _activeVideo: null,

  _indicatorRoot: null,
  _indicatorShadow: null,
  _indicatorEls: null,
  _indicatorPulseTimer: null,
  _indicatorModeTimer: null,
  _indicatorHoverOutTimer: null,
  _indicatorHoverOutToken: 0,
  _indicatorHovering: false,
  _indicatorForced: false,
  _indicatorModeToken: 0,
  _indicatorMode: 'gauge',
  _lastSpeedModeTs: 0,
  _indicatorLast: null,

  apply() {
    if (this._active) return;
    this._active = true;

    this._installFullscreenTracking();
    this._installUserGestureTracking();
    this._scanExistingVideos();
    this._ensureObserver();
  },

  remove() {
    this._active = false;
    this._activeVideo = null;
    this._teardownObserver();
    this._teardownFullscreenTracking();
    this._teardownUserGestureTracking();
    this._detachAllVideos();
    this._removeIndicator();
  },

  _pointerBlockHandler: null,

  _installFullscreenTracking() {
    if (this._boundOnFullscreenChange) return;
    this._boundOnFullscreenChange = () => {
      this._mountPortals();
      this._trySetActiveFromFullscreen();
    };
    document.addEventListener('fullscreenchange', this._boundOnFullscreenChange, true);
    this._pointerBlockHandler = (e) => {
      this._blockPointerDuringRevert(e);
    };
    document.addEventListener('pointerdown', this._pointerBlockHandler, true);
    document.addEventListener('click', this._pointerBlockHandler, true);
  },

  _teardownFullscreenTracking() {
    if (!this._boundOnFullscreenChange) return;
    document.removeEventListener('fullscreenchange', this._boundOnFullscreenChange, true);
    this._boundOnFullscreenChange = null;
    if (this._pointerBlockHandler) {
      document.removeEventListener('pointerdown', this._pointerBlockHandler, true);
      document.removeEventListener('click', this._pointerBlockHandler, true);
      this._pointerBlockHandler = null;
    }
  },

  _installUserGestureTracking() {
    if (this._boundOnUserGesture) return;
    this._boundOnUserGesture = () => {
      this._lastUserGestureTs = Date.now();
    };
    document.addEventListener('pointerdown', this._boundOnUserGesture, true);
    document.addEventListener('mousedown', this._boundOnUserGesture, true);
    document.addEventListener('touchstart', this._boundOnUserGesture, true);
    document.addEventListener('keydown', this._boundOnUserGesture, true);
  },

  _teardownUserGestureTracking() {
    if (!this._boundOnUserGesture) return;
    document.removeEventListener('pointerdown', this._boundOnUserGesture, true);
    document.removeEventListener('mousedown', this._boundOnUserGesture, true);
    document.removeEventListener('touchstart', this._boundOnUserGesture, true);
    document.removeEventListener('keydown', this._boundOnUserGesture, true);
    this._boundOnUserGesture = null;
  },

  _isUserGestureRecent() {
    return Date.now() - this._lastUserGestureTs <= CONFIG.userGestureWindowMs;
  },

  _getPortalMountNode() {
    const fs = document.fullscreenElement;
    if (fs && fs instanceof Element) return fs;
    return document.documentElement || document.body;
  },

  _mountPortals() {
    const mount = this._getPortalMountNode();
    if (!mount) return;
    if (this._indicatorRoot && this._indicatorRoot.parentNode !== mount) {
      try {
        mount.appendChild(this._indicatorRoot);
      } catch (_) {}
    }
  },

  _trySetActiveFromFullscreen() {
    const fs = document.fullscreenElement;
    if (!fs || !(fs instanceof Element)) return;
    if (fs instanceof HTMLVideoElement) return this._setActiveVideo(fs);
    const v = fs.querySelector?.('video');
    if (v && v instanceof HTMLVideoElement) this._setActiveVideo(v);
  },

  _ensureObserver() {
    if (this._observerUnsub) return;
    this._observerUnsub = observerHub.subscribe(
      ({ addedNodes }) => {
        if (!this._active) return;
        for (const node of addedNodes) {
          if (!(node instanceof Element)) continue;
          if (node.tagName === 'VIDEO') this._attachVideo(node);
          if (!node.querySelectorAll) continue;
          node.querySelectorAll('video').forEach((v) => this._attachVideo(v));
        }
      },
      { childList: true, subtree: true }
    );
  },

  _teardownObserver() {
    if (!this._observerUnsub) return;
    this._observerUnsub();
    this._observerUnsub = null;
  },

  _scanExistingVideos() {
    document.querySelectorAll('video').forEach((v) => this._attachVideo(v));
  },

  _setActiveVideo(video) {
    if (!video || !(video instanceof HTMLVideoElement)) return;
    this._activeVideo = video;
    const st = this._getState(video);
    this._ensureIndicator();
    this._updateIndicator(st);
  },

  _getState(video) {
    let st = this._states.get(video);
    if (st) return st;
    const t = clamp(video.currentTime || 0, 0, Number.MAX_SAFE_INTEGER);
    st = {
      lastStableTime: t,
      lastChargeTime: t,
      availableSkips: CONFIG.maxSkips,
      accumulatedTimeSec: 0,
      cooldownUntil: 0,
      lastSrc: String(video.currentSrc || video.src || ''),
      revertTargetTime: null,
      revertTimeoutId: null,
      reverting: false,
      handlers: null,
    };
    this._states.set(video, st);
    return st;
  },

  _syncIdentity(video, st) {
    const src = String(video.currentSrc || video.src || '');
    if (src && st.lastSrc !== src) {
      st.lastSrc = src;
      st.availableSkips = CONFIG.maxSkips;
      st.accumulatedTimeSec = 0;
      st.cooldownUntil = 0;
      const t = clamp(video.currentTime || 0, 0, Number.MAX_SAFE_INTEGER);
      st.lastStableTime = t;
      st.lastChargeTime = t;
    }
  },

  _attachVideo(video) {
    if (!this._active) return;
    if (!(video instanceof HTMLVideoElement)) return;
    if (this._videos.has(video)) return;

    const selectors = getSiteSelectors(window.location?.hostname);
    if (selectors?.overlayExempt && video.closest(selectors.overlayExempt)) return;

    const st = this._getState(video);
    if (st.handlers) return;

    const onTimeUpdate = () => {
      if (!this._active || st.reverting || video.seeking) return;

      const current = clamp(video.currentTime || 0, 0, Number.MAX_SAFE_INTEGER);
      const deltaStable = current - (Number(st.lastStableTime) || 0);
      st.lastStableTime = current;

      if (video.paused) {
        st.lastChargeTime = current;
        if (this._activeVideo === video) this._updateIndicator(st);
        return;
      }

      const deltaCharge = current - (Number(st.lastChargeTime) || current);
      st.lastChargeTime = current;

      if (!(deltaCharge > 0 && deltaCharge <= CONFIG.maxChargeDeltaSec)) {
        if (this._activeVideo === video) this._updateIndicator(st);
        return;
      }

      this._syncIdentity(video, st);

      if (st.availableSkips >= CONFIG.maxSkips) {
        st.accumulatedTimeSec = 0;
        if (this._activeVideo === video) this._updateIndicator(st);
        return;
      }

      if (deltaStable > 0 && deltaStable <= CONFIG.maxChargeDeltaSec) {
        st.accumulatedTimeSec += deltaCharge;
        while (st.accumulatedTimeSec >= CONFIG.secondsPerSkip && st.availableSkips < CONFIG.maxSkips) {
          st.availableSkips += 1;
          st.accumulatedTimeSec -= CONFIG.secondsPerSkip;
        }
        if (st.availableSkips >= CONFIG.maxSkips) st.accumulatedTimeSec = 0;
      }

      if (this._activeVideo === video) this._updateIndicator(st);
    };

    const onSeeking = () => {
      if (!this._active) return;

      this._setActiveVideo(video);

      const from = Number(
        st.reverting && Number.isFinite(st.revertTargetTime) ? st.revertTargetTime : st.lastStableTime
      ) || 0;
      const to = Number(video.currentTime) || 0;
      const delta = to - from;

      if (st.reverting) {
        // Prevent rapid repeated seeks from "slipping through" while we are reverting.
        // Always force the time back to the revert target.
        const target = Number.isFinite(st.revertTargetTime) ? st.revertTargetTime : from;
        if (Number.isFinite(target) && Math.abs((video.currentTime || 0) - target) > 0.05) {
          try {
            video.currentTime = target;
          } catch (_) {}
        }

        // If user keeps trying to skip without credits, keep the speed suggestion visible.
        if (delta > CONFIG.minForwardJumpSec && this._isUserGestureRecent()) {
          const available = Math.max(0, Math.floor(st.availableSkips || 0));
          if (available <= 0) {
            this._setIndicatorMode('speed', { autoReturnMs: CONFIG.speedModeAutoHideMs, reason: 'forced' });
            this._pulseIndicator();
            this._updateIndicator(st);
          }
        }
        return;
      }

      this._pulseIndicator();

      if (!(delta > CONFIG.minForwardJumpSec)) return;

      if (!this._isUserGestureRecent()) {
        const t = clamp(to, 0, Number.MAX_SAFE_INTEGER);
        st.lastStableTime = t;
        st.lastChargeTime = t;
        return;
      }

      this._syncIdentity(video, st);

      const now = Date.now();
      const cooldownLeftMs = Math.max(0, (st.cooldownUntil || 0) - now);
      const canUse = cooldownLeftMs <= 0 && st.availableSkips > 0;

      if (canUse) {
        st.availableSkips -= 1;
        st.cooldownUntil = now + CONFIG.cooldownMs;
        const t = clamp(to, 0, Number.MAX_SAFE_INTEGER);
        st.lastStableTime = t;
        st.lastChargeTime = t;
        this._setIndicatorMode('gauge');
        this._updateIndicator(st);
        return;
      }

      this._blockForwardSeek(video, st, { from });
    };

    const onLoadedMetadata = () => {
      if (!this._active) return;
      this._syncIdentity(video, st);
      if (this._activeVideo === video) this._updateIndicator(st);
    };

    const onPointerEnter = () => {
      if (!this._active) return;
      this._setActiveVideo(video);
    };

    const onPlay = () => {
      if (!this._active) return;
      this._setActiveVideo(video);
    };

    const onRateChange = () => {
      if (!this._active) return;
      if (this._activeVideo !== video) return;
      this._updateIndicator(st);
    };

    st.handlers = { onTimeUpdate, onSeeking, onLoadedMetadata, onPointerEnter, onPlay, onRateChange };
    video.addEventListener('timeupdate', onTimeUpdate, true);
    video.addEventListener('seeking', onSeeking, true);
    video.addEventListener('loadedmetadata', onLoadedMetadata, true);
    video.addEventListener('pointerenter', onPointerEnter, true);
    video.addEventListener('play', onPlay, true);
    video.addEventListener('ratechange', onRateChange, true);

    this._videos.add(video);
    onLoadedMetadata();
    onTimeUpdate();

    if (!this._activeVideo) this._setActiveVideo(video);
  },

  _detachAllVideos() {
    for (const video of this._videos) {
      const st = this._states.get(video);
      const handlers = st?.handlers;
      if (!handlers) continue;
      try {
        video.removeEventListener('timeupdate', handlers.onTimeUpdate, true);
        video.removeEventListener('seeking', handlers.onSeeking, true);
        video.removeEventListener('loadedmetadata', handlers.onLoadedMetadata, true);
        video.removeEventListener('pointerenter', handlers.onPointerEnter, true);
        video.removeEventListener('play', handlers.onPlay, true);
        video.removeEventListener('ratechange', handlers.onRateChange, true);
      } catch (_) {}
      if (st) st.handlers = null;
    }
    this._videos.clear();
  },

  _blockForwardSeek(video, st, info) {
    const now = Date.now();

    const available = Math.max(0, Math.floor(st.availableSkips || 0));
    if (available <= 0) this._lastSpeedModeTs = now;

    this._revert(video, st, info.from);

    if (available <= 0) {
      this._setIndicatorMode('speed', { autoReturnMs: CONFIG.speedModeAutoHideMs, reason: 'forced' });
      this._pulseIndicator();
    } else {
      this._setIndicatorMode('gauge');
    }
    this._updateIndicator(st);
  },

  _revert(video, st, revertTo) {
    if (st.revertTimeoutId) {
      try {
        window.clearTimeout(st.revertTimeoutId);
      } catch (_) {}
      st.revertTimeoutId = null;
    }

    st.reverting = true;
    try {
      video.dataset.frictionSkipReverting = '1';
    } catch (_) {}

    const target = clamp(
      revertTo,
      0,
      isFinitePositive(video.duration) ? video.duration : Number.MAX_SAFE_INTEGER
    );
    st.revertTargetTime = target;
    const schedule = typeof window.requestAnimationFrame === 'function'
      ? window.requestAnimationFrame
      : (cb) => window.setTimeout(cb, 0);
    schedule(() => {
      try {
        video.currentTime = target;
      } catch (_) {}
    });

    st.revertTimeoutId = window.setTimeout(() => {
      st.reverting = false;
      st.revertTimeoutId = null;

      const finalTarget = Number.isFinite(st.revertTargetTime) ? st.revertTargetTime : target;
      st.lastStableTime = finalTarget;
      st.lastChargeTime = finalTarget;
      st.revertTargetTime = null;
      try {
        delete video.dataset.frictionSkipReverting;
      } catch (_) {}
    }, 300);
  },

  _blockPointerDuringRevert(e) {
    if (!this._active) return;
    const target = e.target;
    if (!(target instanceof Element)) return;
    const video = target.closest('video');
    if (!video) return;
    if (video.dataset.frictionSkipReverting !== '1') return;
    try {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    } catch (_) {}
  },

  _applyPlaybackRate(video, rate) {
    const v = video && video instanceof HTMLVideoElement ? video : null;
    if (!v) return;
    const r = clamp(rate, 0.25, 4);

    const host = String(window.location?.hostname || '').toLowerCase();
    const isYouTube = host === 'youtube.com' || host.endsWith('.youtube.com');
    if (isYouTube) {
      const player = document.getElementById('movie_player') || window.movie_player;
      if (player && typeof player.setPlaybackRate === 'function') {
        try {
          player.setPlaybackRate(r);
        } catch (_) {}
      }
    }

    try {
      v.playbackRate = r;
      v.defaultPlaybackRate = r;
    } catch (_) {}
  },

  _pulseIndicator() {
    this._ensureIndicator();
    const capsule = this._indicatorEls?.capsule;
    if (!capsule) return;
    capsule.classList.add('is-active');
    if (this._indicatorPulseTimer) window.clearTimeout(this._indicatorPulseTimer);
    this._indicatorPulseTimer = window.setTimeout(() => {
      capsule.classList.remove('is-active');
    }, CONFIG.indicatorPulseMs);
  },

  _setIndicatorMode(mode, { autoReturnMs, reason } = {}) {
    const next = mode === 'speed' ? 'speed' : 'gauge';
    if (this._indicatorMode === next && !autoReturnMs) return;
    this._indicatorMode = next;

    if (this._indicatorModeTimer) window.clearTimeout(this._indicatorModeTimer);
    this._indicatorModeTimer = null;
    this._indicatorModeToken++;

    if (next === 'speed' && reason === 'forced') this._indicatorForced = true;
    if (next === 'gauge') this._indicatorForced = false;

    const capsule = this._indicatorEls?.capsule;
    if (capsule) {
      capsule.setAttribute('data-mode', next);
      capsule.setAttribute('aria-live', next === 'speed' ? 'polite' : 'off');
    }

    if (next === 'speed' && autoReturnMs && autoReturnMs > 0) {
      const token = this._indicatorModeToken;
      this._indicatorModeTimer = window.setTimeout(() => {
        if (token !== this._indicatorModeToken) return;
        this._indicatorForced = false;
        if (!this._indicatorHovering) this._setIndicatorMode('gauge');
      }, autoReturnMs);
    }
  },

  _ensureIndicator() {
    if (this._indicatorRoot && this._indicatorShadow && this._indicatorEls) return;

    const root = document.createElement('div');
    root.id = 'friction-video-skip-indicator';
    root.className = 'theme-nordic-dark';
    root.style.position = 'fixed';
    root.style.right = '14px';
    root.style.top = '14px';
    root.style.zIndex = '2147483647';
    root.style.pointerEvents = 'none';

    const shadow = root.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        :host(.theme-nordic-dark) {
          --vs-bg: rgba(32, 35, 38, 0.78);
          --vs-fg: #e2e4e9;
          --vs-muted: #9199a5;
          --vs-border: rgba(255, 255, 255, 0.08);
          --vs-accent: #8aad94;
          --vs-accent-strong: #a3be8c;
          --vs-shadow: 0 14px 35px rgba(0, 0, 0, 0.35);
          --vs-radius: 20px;
          --vs-idle-opacity: ${CONFIG.indicatorIdleOpacity};
        }

        .capsule {
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 12px;
          border-radius: var(--vs-radius);
          background: var(--vs-bg);
          border: 1px solid var(--vs-border);
          box-shadow: var(--vs-shadow);
          backdrop-filter: blur(10px);
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Apple SD Gothic Neo, 'Noto Sans KR', sans-serif;
          letter-spacing: 0.02em;
          user-select: none;
          opacity: var(--vs-idle-opacity);
          transition: opacity 180ms ease, transform 180ms ease;
        }

        .capsule:hover,
        .capsule.is-active {
          opacity: 1;
        }

        .capsule.is-empty .dot.is-filled {
          background: rgba(212, 138, 138, 0.9);
          box-shadow: 0 0 0 1px rgba(212, 138, 138, 0.32);
        }

        .left {
          display: flex;
          flex-direction: column;
          gap: 6px;
          min-width: 150px;
        }

        .row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .label {
          font-size: 11px;
          font-weight: 900;
          color: var(--vs-fg);
          opacity: 0.92;
        }

        .count {
          font-size: 11px;
          font-weight: 800;
          color: var(--vs-muted);
        }

        .dots {
          display: flex;
          gap: 6px;
          align-items: center;
        }

        .dot {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.08);
          box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08);
          transition: background 180ms ease, box-shadow 180ms ease;
        }

        .dot.is-filled {
          background: rgba(138, 173, 148, 0.92);
          box-shadow: 0 0 0 1px rgba(138, 173, 148, 0.28);
        }

        .sub {
          font-size: 10px;
          color: var(--vs-muted);
          opacity: 0.9;
        }

        .ring {
          width: 24px;
          height: 24px;
          flex: 0 0 auto;
        }

        .ring circle {
          fill: none;
          stroke-width: 2;
          stroke-linecap: round;
        }

        .ring .bg { stroke: rgba(255, 255, 255, 0.08); }
        .ring .fg {
          stroke: var(--vs-accent-strong);
          transition: stroke-dashoffset 220ms ease;
        }

        .capsule.is-empty .ring .fg {
          stroke: rgba(212, 138, 138, 0.9);
        }

        .view { display: none; }
        .capsule[data-mode="gauge"] .view-gauge { display: block; }
        .capsule[data-mode="speed"] .view-speed { display: block; }

        .speed-wrap {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 190px;
        }

        .speed-title {
          font-size: 12px;
          font-weight: 900;
          color: var(--vs-fg);
          opacity: 0.95;
        }

        .speed-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          align-items: center;
          flex-wrap: wrap;
        }

        .sbtn {
          border: 1px solid var(--vs-border);
          background: rgba(45, 50, 56, 0.75);
          color: var(--vs-fg);
          padding: 8px 10px;
          border-radius: 12px;
          font-weight: 850;
          cursor: pointer;
        }

        .sbtn.is-active {
          background: rgba(138, 173, 148, 0.95);
          border-color: transparent;
        }

        .sbtn.ghost {
          background: transparent;
        }

        .capsule:focus-visible { outline: 3px solid rgba(138, 173, 148, 0.35); outline-offset: 2px; }
        .sbtn:focus-visible { outline: 3px solid rgba(138, 173, 148, 0.35); outline-offset: 2px; }

        @media (prefers-reduced-motion: reduce) {
          .capsule { transition: none !important; }
          .ring .fg { transition: none !important; }
        }
      </style>

      <div class="capsule" id="capsule" aria-label="Video skip credits" data-mode="gauge" tabindex="0">
        <div class="view view-gauge">
          <div class="left">
            <div class="row">
              <div class="label">SKIP</div>
              <div class="count" id="count"></div>
            </div>
            <div class="row">
              <div class="dots" id="dots">
                <span class="dot" data-dot="0"></span>
                <span class="dot" data-dot="1"></span>
                <span class="dot" data-dot="2"></span>
              </div>
              <svg class="ring" viewBox="0 0 24 24" aria-hidden="true">
                <circle class="bg" cx="12" cy="12" r="9"></circle>
                <circle class="fg" id="ringFg" cx="12" cy="12" r="9"></circle>
              </svg>
            </div>
            <div class="sub" id="sub"></div>
          </div>
        </div>

        <div class="view view-speed">
          <div class="speed-wrap">
            <div class="speed-title" id="speedTitle">스킵권 없음 · 배속으로 이어보기</div>
            <div class="sub" id="speedSub"></div>
            <div class="speed-actions">
              <button class="sbtn ghost" data-action="back" type="button">닫기</button>
              <button class="sbtn" data-rate="1" type="button">1.0x</button>
              <button class="sbtn" data-rate="1.25" type="button">1.25x</button>
              <button class="sbtn" data-rate="1.5" type="button">1.5x</button>
            </div>
          </div>
        </div>
      </div>
    `;

    const capsule = shadow.getElementById('capsule');
    const count = shadow.getElementById('count');
    const sub = shadow.getElementById('sub');
    const speedSub = shadow.getElementById('speedSub');
    const speedTitle = shadow.getElementById('speedTitle');
    const ringFg = shadow.getElementById('ringFg');
    const dots = Array.from(shadow.querySelectorAll('.dot'));
    const speedButtons = Array.from(shadow.querySelectorAll('.sbtn[data-rate]'));

    const circumference = 2 * Math.PI * 9;
    if (ringFg) {
      ringFg.style.strokeDasharray = `${circumference}`;
      ringFg.style.strokeDashoffset = `${circumference}`;
    }

    if (capsule) {
      capsule.addEventListener('pointerenter', () => {
        this._indicatorHovering = true;
        this._indicatorHoverOutToken++;
        if (this._indicatorHoverOutTimer) window.clearTimeout(this._indicatorHoverOutTimer);
        this._indicatorHoverOutTimer = null;

        this._setIndicatorMode('speed', { reason: 'hover' });
        const v = this._activeVideo;
        if (v && v instanceof HTMLVideoElement) this._updateIndicator(this._getState(v));
      });

      capsule.addEventListener('pointerleave', () => {
        this._indicatorHovering = false;
        const token = ++this._indicatorHoverOutToken;
        if (this._indicatorHoverOutTimer) window.clearTimeout(this._indicatorHoverOutTimer);
        this._indicatorHoverOutTimer = window.setTimeout(() => {
          if (token !== this._indicatorHoverOutToken) return;
          if (this._indicatorForced) return;
          this._setIndicatorMode('gauge');
        }, 280);
      });

      capsule.addEventListener('click', (e) => {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;
        const action = target.getAttribute('data-action');
        if (action === 'back') {
          if (!this._indicatorHovering && !this._indicatorForced) this._setIndicatorMode('gauge');
          return;
        }
        const rateAttr = target.getAttribute('data-rate');
        if (!rateAttr) return;
        const rate = parseFloat(rateAttr);
        this._applyPlaybackRate(this._activeVideo, rate);
        if (!this._indicatorHovering && !this._indicatorForced) this._setIndicatorMode('gauge');
      });

      capsule.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') this._setIndicatorMode('gauge');
      });
    }

    this._indicatorRoot = root;
    this._indicatorShadow = shadow;
    this._indicatorEls = {
      capsule,
      count,
      sub,
      speedSub,
      speedTitle,
      speedButtons,
      ringFg,
      dots,
      circumference,
    };
    this._indicatorLast = { availableSkips: null, progress: null, cooldownLeft: null, untilNextSec: null };

    const mount = this._getPortalMountNode();
    (mount || document.documentElement || document.body)?.appendChild(root);
    this._mountPortals();
    this._setIndicatorMode('gauge');
  },

  _updateIndicator(st) {
    if (!st) return;
    if (!this._indicatorEls) this._ensureIndicator();
    const els = this._indicatorEls;
    if (!els) return;

    const available = Math.max(0, Math.min(CONFIG.maxSkips, Math.floor(st.availableSkips || 0)));
    const progress =
      available >= CONFIG.maxSkips
        ? 1
        : clamp((Number(st.accumulatedTimeSec) || 0) / CONFIG.secondsPerSkip, 0, 1);
    const cooldownLeft = Math.max(0, Math.ceil(((st.cooldownUntil || 0) - Date.now()) / 1000));
    const untilNextSec =
      available < CONFIG.maxSkips
        ? Math.max(0, Math.ceil(CONFIG.secondsPerSkip - (Number(st.accumulatedTimeSec) || 0)))
        : 0;

    const last = this._indicatorLast || {};
    const progressRounded = Math.round(progress * 1000) / 1000;

    if (last.availableSkips !== available && els.count) {
      els.count.textContent = `${available}/${CONFIG.maxSkips}`;
    }

    if (last.availableSkips !== available && Array.isArray(els.dots)) {
      els.dots.forEach((dot, i) => dot.classList.toggle('is-filled', i < available));
      els.capsule?.classList.toggle('is-empty', available === 0);
    }

    if (last.progress !== progressRounded && els.ringFg) {
      const offset = els.circumference * (1 - progressRounded);
      els.ringFg.style.strokeDashoffset = `${offset}`;
    }

    if (
      (last.cooldownLeft !== cooldownLeft ||
        last.availableSkips !== available ||
        last.untilNextSec !== untilNextSec) &&
      els.sub
    ) {
      const parts = [];
      if (available < CONFIG.maxSkips) parts.push(`+1까지 ${formatSeconds(untilNextSec)}`);
      else parts.push('FULL');
      if (cooldownLeft > 0 && CONFIG.cooldownMs > 0) parts.push(`쿨다운 ${formatSeconds(cooldownLeft)}`);
      els.sub.textContent = parts.join(' · ');
    }

    if (
      (last.cooldownLeft !== cooldownLeft ||
        last.availableSkips !== available ||
        last.untilNextSec !== untilNextSec) &&
      els.speedSub
    ) {
      const parts = [];
      if (available < CONFIG.maxSkips) parts.push(`+1까지 ${formatSeconds(untilNextSec)}`);
      if (cooldownLeft > 0 && CONFIG.cooldownMs > 0) parts.push(`쿨다운 ${formatSeconds(cooldownLeft)}`);
      els.speedSub.textContent = parts.join(' · ');
    }

    if (available > 0 && this._indicatorMode === 'speed' && !this._indicatorHovering && !this._indicatorForced) {
      this._setIndicatorMode('gauge');
    }

    const activeRate = clamp(Number(this._activeVideo?.playbackRate) || 1, 0.25, 4);
    const rateCandidates = [1, 1.25, 1.5];
    let nearest = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const r of rateCandidates) {
      const dist = Math.abs(activeRate - r);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = r;
      }
    }
    if (bestDist > 0.06) nearest = null;

    if (Array.isArray(els.speedButtons)) {
      for (const btn of els.speedButtons) {
        const r = parseFloat(String(btn.getAttribute('data-rate') || ''));
        btn.classList.toggle('is-active', nearest !== null && Number.isFinite(r) && Math.abs(r - nearest) < 0.001);
      }
    }

    if (els.speedTitle) {
      const label = nearest !== null ? `${nearest.toFixed(2).replace(/\\.00$/, '')}x` : `${activeRate.toFixed(2)}x`;
      els.speedTitle.textContent = `현재 ${label} · 배속으로 이어보기`;
    }

    this._indicatorLast = { availableSkips: available, progress: progressRounded, cooldownLeft, untilNextSec };
  },

  _removeIndicator() {
    if (this._indicatorPulseTimer) window.clearTimeout(this._indicatorPulseTimer);
    this._indicatorPulseTimer = null;
    if (this._indicatorModeTimer) window.clearTimeout(this._indicatorModeTimer);
    this._indicatorModeTimer = null;
    if (this._indicatorHoverOutTimer) window.clearTimeout(this._indicatorHoverOutTimer);
    this._indicatorHoverOutTimer = null;

    this._indicatorModeToken++;
    this._indicatorMode = 'gauge';
    this._indicatorForced = false;
    this._indicatorHovering = false;
    this._indicatorHoverOutToken++;
    this._indicatorLast = null;
    this._indicatorEls = null;
    this._indicatorShadow = null;

    if (this._indicatorRoot) {
      try {
        this._indicatorRoot.remove();
      } catch (_) {}
    }
    this._indicatorRoot = null;
  },
};

export default VideoSkipManager;

