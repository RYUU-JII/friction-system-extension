import { CONFIG_DEFAULT_FILTER_SETTINGS, normalizeFilterSettings } from '../../../shared/config/index.js';

const DEFAULT_NUDGE_AUTO_CONFIG = {
  enabled: false,
  thresholdMs: 30 * 60 * 1000,
};

function isWebUrl(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}

export function createUtilTab({ UI, getSettings, setSettings }) {
  function storageGet(defaults) {
    return new Promise((resolve) => {
      chrome.storage.local.get(defaults || {}, (items) => resolve(items || {}));
    });
  }

  function storageSet(items) {
    return new Promise((resolve) => {
      chrome.storage.local.set(items || {}, () => resolve());
    });
  }

  function mergeFilterSettings(partial) {
    return normalizeFilterSettings(partial || {});
  }

  function normalizeNudgeAutoConfig(raw) {
    const src = raw && typeof raw === 'object' ? raw : {};
    const enabled = typeof src.enabled === 'boolean' ? src.enabled : DEFAULT_NUDGE_AUTO_CONFIG.enabled;
    const thresholdMsRaw = Number(src.thresholdMs);
    const thresholdMs = Number.isFinite(thresholdMsRaw) ? Math.max(0, thresholdMsRaw) : DEFAULT_NUDGE_AUTO_CONFIG.thresholdMs;
    return { enabled, thresholdMs };
  }

  function minutesFromMs(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n)) return 30;
    return Math.max(5, Math.min(240, Math.round(n / 60000)));
  }

  function setNudgeDebugStatus(text) {
    if (UI.nudgeDebugStatus) UI.nudgeDebugStatus.textContent = text || '';
  }

  function syncNudgeAutoUI(config) {
    if (!UI.nudgeAutoToggle || !UI.nudgeAutoThresholdRange) return;

    UI.nudgeAutoToggle.checked = !!config.enabled;

    const minutes = minutesFromMs(config.thresholdMs);
    UI.nudgeAutoThresholdRange.value = String(minutes);
    UI.nudgeAutoThresholdRange.disabled = !config.enabled;

    if (UI.nudgeAutoToggleOutput) UI.nudgeAutoToggleOutput.textContent = config.enabled ? 'ON' : 'OFF';
    if (UI.nudgeAutoThresholdOutput) UI.nudgeAutoThresholdOutput.textContent = `${minutes}분`;
  }

  async function loadNudgeAutoConfigAndSyncUI() {
    const items = await storageGet({ nudgeConfig: {} });
    const config = normalizeNudgeAutoConfig(items.nudgeConfig);
    syncNudgeAutoUI(config);
    return config;
  }

  async function updateNudgeAutoConfig(patch) {
    const items = await storageGet({ nudgeConfig: {} });
    const current = normalizeNudgeAutoConfig(items.nudgeConfig);

    const enabled = typeof patch?.enabled === 'boolean' ? patch.enabled : current.enabled;
    const thresholdMsRaw = patch && patch.thresholdMs !== undefined ? Number(patch.thresholdMs) : current.thresholdMs;
    const thresholdMs = Number.isFinite(thresholdMsRaw) ? Math.max(0, thresholdMsRaw) : current.thresholdMs;

    const next = {
      ...(items.nudgeConfig && typeof items.nudgeConfig === 'object' ? items.nudgeConfig : {}),
      enabled,
      thresholdMs,
    };

    await storageSet({ nudgeConfig: next });
    chrome.runtime.sendMessage({ action: 'NUDGE_CONFIG_UPDATED' });

    const normalized = normalizeNudgeAutoConfig(next);
    syncNudgeAutoUI(normalized);
    return normalized;
  }

  function syncNudgeDebugOutputs() {
    const size = parseInt(UI.nudgeSizeRange?.value || '96', 10) || 96;
    const speed = parseInt(UI.nudgeSpeedRange?.value || '140', 10) || 140;
    const interval = parseInt(UI.nudgeSpawnIntervalRange?.value || '4000', 10) || 4000;
    const maxSprites = parseInt(UI.nudgeMaxSpritesRange?.value || '6', 10) || 6;
    const ramp = parseFloat(UI.nudgeSpeedRampRange?.value || '1.15') || 1.15;

    if (UI.nudgeSizeOutput) UI.nudgeSizeOutput.textContent = `${size}px`;
    if (UI.nudgeSpeedOutput) UI.nudgeSpeedOutput.textContent = `${speed}`;
    if (UI.nudgeSpawnIntervalOutput) UI.nudgeSpawnIntervalOutput.textContent = `${interval}ms`;
    if (UI.nudgeMaxSpritesOutput) UI.nudgeMaxSpritesOutput.textContent = `${maxSprites}`;
    if (UI.nudgeSpeedRampOutput) UI.nudgeSpeedRampOutput.textContent = `${ramp.toFixed(2)}x`;
  }

  function getNudgeDebugConfigFromUI() {
    const size = parseInt(UI.nudgeSizeRange?.value || '96', 10) || 96;
    const speed = parseInt(UI.nudgeSpeedRange?.value || '140', 10) || 140;
    const interval = parseInt(UI.nudgeSpawnIntervalRange?.value || '4000', 10) || 4000;
    const maxSprites = parseInt(UI.nudgeMaxSpritesRange?.value || '6', 10) || 6;
    const ramp = parseFloat(UI.nudgeSpeedRampRange?.value || '1.15') || 1.15;

    return {
      spriteSizePx: size,
      baseSpeedPxPerSec: speed,
      spawnIntervalMs: interval,
      maxSprites,
      speedRamp: ramp,
      asset: {
        gifPath: 'samples/images/nudge-object.gif',
        audioPath: 'samples/sounds/nudge-music.mp3',
        label: 'nudge-object',
      },
      message: {
        title: '잠깐!',
        body: '늘 차단 중이에요. 무례했거나 불편함으로 돌아가세요.',
      },
    };
  }

  function getLastActiveTabId() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'DEBUG_GET_CACHE' }, (resp) => {
        resolve(resp?.lastActiveTab ?? null);
      });
    });
  }

  function getTab(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.get(tabId, (tab) => resolve(tab || null));
    });
  }

  function queryTabs(queryInfo) {
    return new Promise((resolve) => {
      chrome.tabs.query(queryInfo, (tabs) => resolve(Array.isArray(tabs) ? tabs : []));
    });
  }

  async function resolveTargetTabId() {
    const lastId = await getLastActiveTabId();
    if (typeof lastId === 'number') {
      const tab = await getTab(lastId);
      if (tab && isWebUrl(tab.url)) return lastId;
    }

    const tabs = await queryTabs({ lastFocusedWindow: true });
    const candidate = tabs.find((t) => isWebUrl(t.url));
    return candidate?.id ?? null;
  }

  async function sendNudgeDebugMessage(message) {
    const tabId = await resolveTargetTabId();
    if (!tabId) {
      setNudgeDebugStatus('탭을 찾지 못했어요.');
      return;
    }

    const trySend = () =>
      new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, message, () => {
          const err = chrome.runtime.lastError?.message;
          resolve(err || null);
        });
      });

    const tryInject = () =>
      new Promise((resolve) => {
        chrome.scripting.executeScript(
          {
            target: { tabId },
            files: ['entries/content/earlyApplyLoader.js', 'entries/content/loader.js'],
          },
          () => {
            const err = chrome.runtime.lastError?.message;
            resolve(err || null);
          }
        );
      });

    const err1 = await trySend();
    if (!err1) {
      setNudgeDebugStatus(`전송 완료 (tabId: ${tabId})`);
      return;
    }

    if (String(err1).includes('Receiving end does not exist')) {
      setNudgeDebugStatus('콘텐츠스크립트가 아직 주입 중입니다...');
      const injectErr = await tryInject();
      if (injectErr) {
        setNudgeDebugStatus(`주입 실패: ${injectErr}`);
        return;
      }

      const err2 = await trySend();
      if (err2) {
        setNudgeDebugStatus(`전송 실패: ${err2}`);
        return;
      }

      setNudgeDebugStatus(`전송 완료 (주입 후) (tabId: ${tabId})`);
      return;
    }

    setNudgeDebugStatus(`전송 실패: ${err1}`);
  }

  async function persistCurrentSettings(nextSettings) {
    const merged = mergeFilterSettings(nextSettings || getSettings());
    await storageSet({ filterSettings: merged });
    setSettings(merged);
    chrome.runtime.sendMessage({ action: 'SETTINGS_UPDATED' });
  }

  function readVideoSkipGuardSetting() {
    const settings = getSettings() || {};
    return settings.videoSkipGuard || CONFIG_DEFAULT_FILTER_SETTINGS.videoSkipGuard || { isActive: false, value: '' };
  }

  function syncVideoSkipGuardUI() {
    if (!UI.utilVideoSkipGuardToggle) return;
    const setting = readVideoSkipGuardSetting();
    UI.utilVideoSkipGuardToggle.checked = !!setting.isActive;
    if (UI.utilVideoSkipGuardStatus) UI.utilVideoSkipGuardStatus.textContent = setting.isActive ? 'ON' : 'OFF';
    if (UI.utilVideoSkipGuardCard) UI.utilVideoSkipGuardCard.classList.toggle('is-on', !!setting.isActive);
  }

  function setup() {
    if (UI.utilVideoSkipGuardToggle) {
      UI.utilVideoSkipGuardToggle.addEventListener('change', () => {
        const next = { ...(getSettings() || {}) };
        const prev = readVideoSkipGuardSetting();
        next.videoSkipGuard = { isActive: !!UI.utilVideoSkipGuardToggle.checked, value: prev.value };
        setSettings(next);
        syncVideoSkipGuardUI();
        persistCurrentSettings(next).catch(() => {});
      });
    }

    if (UI.nudgeDebugPanel) {
      if (UI.nudgeAutoToggle && UI.nudgeAutoThresholdRange) {
        UI.nudgeAutoToggle.addEventListener('change', async () => {
          const enabled = !!UI.nudgeAutoToggle.checked;
          const next = await updateNudgeAutoConfig({ enabled });
          setNudgeDebugStatus(`자동 개입: ${next.enabled ? 'ON' : 'OFF'}`);
        });

        UI.nudgeAutoThresholdRange.addEventListener('input', () => {
          const minutes = parseInt(String(UI.nudgeAutoThresholdRange.value || '30'), 10) || 30;
          if (UI.nudgeAutoThresholdOutput) UI.nudgeAutoThresholdOutput.textContent = `${minutes}분`;
        });

        UI.nudgeAutoThresholdRange.addEventListener('change', async () => {
          const minutes = parseInt(String(UI.nudgeAutoThresholdRange.value || '30'), 10) || 30;
          const next = await updateNudgeAutoConfig({ thresholdMs: minutes * 60 * 1000 });
          setNudgeDebugStatus(`자동 개입 기준: ${minutesFromMs(next.thresholdMs)}분`);
        });
      }

      const syncAndPush = () => {
        syncNudgeDebugOutputs();
        const config = getNudgeDebugConfigFromUI();
        sendNudgeDebugMessage({ type: 'NUDGE_DEBUG_CONFIG', payload: { config } }).catch(() => {});
      };

      UI.nudgeSizeRange?.addEventListener('input', syncAndPush);
      UI.nudgeSpeedRange?.addEventListener('input', syncAndPush);
      UI.nudgeSpawnIntervalRange?.addEventListener('input', syncAndPush);
      UI.nudgeMaxSpritesRange?.addEventListener('input', syncAndPush);
      UI.nudgeSpeedRampRange?.addEventListener('input', syncAndPush);

      UI.nudgeSpawnBtn?.addEventListener('click', () => {
        syncNudgeDebugOutputs();
        const config = getNudgeDebugConfigFromUI();
        sendNudgeDebugMessage({ type: 'NUDGE_DEBUG_SPAWN', payload: { config } }).catch(() => {});
      });

      UI.nudgeStopBtn?.addEventListener('click', () => {
        sendNudgeDebugMessage({ type: 'NUDGE_STOP' }).catch(() => {});
      });
    }
  }

  async function display() {
    syncVideoSkipGuardUI();
    syncNudgeDebugOutputs();
    await loadNudgeAutoConfigAndSyncUI();
  }

  return { setup, display };
}

