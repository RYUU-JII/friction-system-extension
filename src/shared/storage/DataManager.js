import { CONFIG_DEFAULT_FILTER_SETTINGS } from '../config/index.js';

class DataManager {
  constructor() {
    this.local = chrome?.storage?.local;
    this.session = chrome?.storage?.session;
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
    const items = await this.getLocal({ filterSettings: CONFIG_DEFAULT_FILTER_SETTINGS });
    return items.filterSettings || { ...CONFIG_DEFAULT_FILTER_SETTINGS };
  }

  setFilterSettings(filterSettings) {
    return this.setLocal({ filterSettings: filterSettings || CONFIG_DEFAULT_FILTER_SETTINGS });
  }

  async getSchedule() {
    const items = await this.getLocal({ schedule: { scheduleActive: false, startMin: 0, endMin: 1440 } });
    return items.schedule || { scheduleActive: false, startMin: 0, endMin: 1440 };
  }

  setSchedule(schedule) {
    return this.setLocal({ schedule: schedule || { scheduleActive: false, startMin: 0, endMin: 1440 } });
  }

  async getStats() {
    const items = await this.getLocal({ stats: { dates: {} } });
    return items.stats || { dates: {} };
  }

  setStats(stats) {
    return this.setLocal({ stats: stats || { dates: {} } });
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
