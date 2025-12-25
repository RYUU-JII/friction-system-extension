import { CONFIG_DEFAULT_FILTER_SETTINGS } from '../config/index.js';

class DataManager {
  constructor() {
    this.local = chrome?.storage?.local;
    this.session = chrome?.storage?.session;
    this.filterSettingsCache = null;
    this._onChangedBound = null;

    if (this.local && chrome?.storage?.onChanged) {
      this._onChangedBound = (changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes.filterSettings) {
          this.filterSettingsCache =
            changes.filterSettings.newValue || { ...CONFIG_DEFAULT_FILTER_SETTINGS };
        }
      };
      chrome.storage.onChanged.addListener(this._onChangedBound);
    }
  }

  static getInstance() {
    if (!DataManager.instance) DataManager.instance = new DataManager();
    return DataManager.instance;
  }

  getLocal(defaults = {}) {
    if (!this.local) return Promise.resolve({ ...defaults });
    return new Promise((resolve) => {
      this.local.get(defaults, (items) => resolve(items || { ...defaults }));
    });
  }

  setLocal(items = {}) {
    if (!this.local) return Promise.resolve();
    return new Promise((resolve) => {
      this.local.set(items, () => resolve());
    });
  }

  getSession(defaults = {}) {
    if (!this.session) return Promise.resolve({ ...defaults });
    return new Promise((resolve) => {
      this.session.get(defaults, (items) => resolve(items || { ...defaults }));
    });
  }

  setSession(items = {}) {
    if (!this.session) return Promise.resolve();
    return new Promise((resolve) => {
      this.session.set(items, () => resolve());
    });
  }

  async getBlockedUrls() {
    const items = await this.getLocal({ blockedUrls: [] });
    return Array.isArray(items.blockedUrls) ? items.blockedUrls : [];
  }

  setBlockedUrls(blockedUrls) {
    return this.setLocal({ blockedUrls: Array.isArray(blockedUrls) ? blockedUrls : [] });
  }

  async getFilterSettings() {
    if (this.filterSettingsCache) return this.filterSettingsCache;
    const items = await this.getLocal({ filterSettings: CONFIG_DEFAULT_FILTER_SETTINGS });
    const next = items.filterSettings || { ...CONFIG_DEFAULT_FILTER_SETTINGS };
    this.filterSettingsCache = next;
    return next;
  }

  setFilterSettings(filterSettings) {
    this.filterSettingsCache = filterSettings || CONFIG_DEFAULT_FILTER_SETTINGS;
    return this.setLocal({ filterSettings: this.filterSettingsCache });
  }

  async getSchedule() {
    const items = await this.getLocal({ schedule: { scheduleActive: false, startMin: 0, endMin: 1440 } });
    return items.schedule || { scheduleActive: false, startMin: 0, endMin: 1440 };
  }

  setSchedule(schedule) {
    return this.setLocal({ schedule: schedule || { scheduleActive: false, startMin: 0, endMin: 1440 } });
  }

  async getStats() {
    const items = await this.getLocal({ stats: { dates: {}, analysisLogs: [] } });
    const stats = items.stats || { dates: {}, analysisLogs: [] };
    if (!stats.dates || typeof stats.dates !== 'object') stats.dates = {};
    if (!Array.isArray(stats.analysisLogs)) stats.analysisLogs = [];
    return stats;
  }

  setStats(stats) {
    const next = stats || { dates: {}, analysisLogs: [] };
    if (!next.dates || typeof next.dates !== 'object') next.dates = {};
    if (!Array.isArray(next.analysisLogs)) next.analysisLogs = [];
    return this.setLocal({ stats: next });
  }

  async purgeOldLogs(days = 7) {
    const spanDays = Number.isFinite(Number(days)) ? Math.max(1, Number(days)) : 7;
    const cutoff = Date.now() - spanDays * 24 * 60 * 60 * 1000;
    const stats = await this.getStats();
    const logs = Array.isArray(stats.analysisLogs) ? stats.analysisLogs : [];
    const filtered = logs.filter((entry) => {
      const ts = Number(entry?.ts ?? entry?.timestamp ?? entry?.time);
      if (!Number.isFinite(ts)) return true;
      return ts >= cutoff;
    });
    if (filtered.length === logs.length) return stats;
    const nextStats = { ...stats, analysisLogs: filtered };
    await this.setStats(nextStats);
    return nextStats;
  }

  async getEngineState() {
    const items = await this.getLocal({ engineState: {} });
    return items.engineState || {};
  }

  setEngineState(engineState) {
    return this.setLocal({ engineState: engineState || {} });
  }

  async getNudgeConfig() {
    const items = await this.getLocal({ nudgeConfig: {} });
    return items.nudgeConfig || {};
  }

  setNudgeConfig(nudgeConfig) {
    return this.setLocal({ nudgeConfig: nudgeConfig || {} });
  }
}

export default DataManager;
