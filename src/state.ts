// 插件全局状态
import type { ActionMap } from 'napcat-types/napcat-onebot/action/index';
import type { PluginLogger } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { NetworkAdapterConfig } from 'napcat-types/napcat-onebot/config/config';
import type { PluginConfig, EventCache } from './types';
import { DEFAULT_CONFIG } from './config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

interface LogEntry { time: number; level: string; msg: string; }

// 运行时从 package.json 读取版本号
function getPluginVersion (): string {
  try {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const pkgPath = path.join(__dirname, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '1.0.0';
    }
  } catch { /* 读取失败使用默认版本 */ }
  return '1.0.0';
}

class PluginState {
  /** 插件版本（运行时从 package.json 读取） */
  version: string = getPluginVersion();
  logger: PluginLogger | null = null;
  actions: ActionMap | undefined;
  adapterName = '';
  networkConfig: NetworkAdapterConfig | null = null;
  config: PluginConfig = { ...DEFAULT_CONFIG, subscriptions: [] };
  configPath = '';
  dataPath = '';
  cache: EventCache = {};
  logBuffer: LogEntry[] = [];
  private readonly maxLogEntries = 500;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  private pushLog (level: string, msg: string): void {
    this.logBuffer.push({ time: Date.now(), level, msg });
    if (this.logBuffer.length > this.maxLogEntries) this.logBuffer.splice(0, this.logBuffer.length - this.maxLogEntries);
  }

  log (level: 'info' | 'warn' | 'error', msg: string): void {
    this.logger?.[level](`[GitHub Sub] ${msg}`);
    this.pushLog(level, msg);
  }

  debug (msg: string): void {
    if (this.config.debug) {
      this.pushLog('debug', msg);
    }
  }

  clearLogs (): void { this.logBuffer = []; }

  saveConfig (): void {
    if (!this.configPath) return;
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
    } catch (e) { this.log('error', `保存配置失败: ${e}`); }
  }

  saveCache (): void {
    if (!this.dataPath) return;
    try {
      const fp = path.join(this.dataPath, 'cache.json');
      if (!fs.existsSync(this.dataPath)) fs.mkdirSync(this.dataPath, { recursive: true });
      fs.writeFileSync(fp, JSON.stringify(this.cache, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }

  loadCache (): void {
    try {
      const fp = path.join(this.dataPath, 'cache.json');
      if (fs.existsSync(fp)) this.cache = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch { /* ignore */ }
  }

  setPollTimer (timer: ReturnType<typeof setInterval>): void { this.pollTimer = timer; }
  clearPollTimer (): void {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  async sendGroupMsg (groupId: string, message: unknown): Promise<void> {
    if (!this.actions || !this.networkConfig) return;
    await this.actions.call('send_group_msg', { group_id: groupId, message } as never, this.adapterName, this.networkConfig).catch(() => { });
  }
}

export const pluginState = new PluginState();
