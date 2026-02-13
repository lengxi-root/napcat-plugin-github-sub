// NapCat GitHub 订阅插件
import type { PluginModule, NapCatPluginContext, PluginConfigSchema } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import fs from 'fs';
import path from 'path';
import type { PluginConfig } from './types';
import { DEFAULT_CONFIG } from './config';
import { pluginState } from './state';
import { handleCommand } from './commands';
import { registerApiRoutes } from './api';
import { startPoller, stopPoller } from './poller';

export let plugin_config_ui: PluginConfigSchema = [];

const PREFIX = 'gh';

// 初始化
const plugin_init: PluginModule['plugin_init'] = async (ctx: NapCatPluginContext) => {
  Object.assign(pluginState, {
    logger: ctx.logger,
    actions: ctx.actions,
    adapterName: ctx.adapterName,
    networkConfig: ctx.pluginManager.config,
    dataPath: ctx.dataPath || path.join(path.dirname(ctx.configPath), 'data'),
    configPath: ctx.configPath,
  });

  pluginState.log('info', 'GitHub 订阅插件初始化中...');

  // 配置 UI — 仅展示信息，引导用户前往 WebUI 配置
  try {
    const C = ctx.NapCatConfig;
    if (C) {
      plugin_config_ui = C.combine(
        C.html(`
          <div style="padding: 16px; background: linear-gradient(135deg, rgba(31,111,235,0.1), rgba(31,35,40,0.1)); border: 1px solid rgba(31,111,235,0.3); border-radius: 12px; margin-bottom: 20px; box-shadow: 0 2px 6px rgba(0,0,0,0.04); font-family: system-ui, -apple-system, sans-serif;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
              <div style="width: 36px; height: 36px; background: #24292f; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">
                <svg width="20" height="20" viewBox="0 0 16 16" fill="#fff"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
              </div>
              <div>
                <h3 style="margin: 0; font-size: 16px; font-weight: 600; color: #374151;">GitHub 订阅推送 v1.0.0</h3>
                <p style="margin: 2px 0 0; font-size: 12px; color: #9ca3af;">napcat-plugin-github-sub | 作者: 冷曦</p>
              </div>
            </div>
            <p style="margin: 0; font-size: 13px; color: #6b7280; line-height: 1.5;">
              监控 GitHub 仓库的 Commits / Issues / PR 并推送到群 | 
              发送 <code style="background: rgba(31,111,235,0.15); padding: 2px 6px; border-radius: 4px; color: #1f6feb;">gh帮助</code> 查看指令
            </p>
          </div>
        `),
        C.html(`
          <div style="padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; display: flex; gap: 10px; align-items: center; font-family: system-ui, -apple-system, sans-serif;">
            <div style="color: #6b7280; flex-shrink: 0;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            </div>
            <div style="font-size: 13px; color: #4b5563;">
              所有配置（Token、主人权限、订阅管理、主题等）请前往 
              <a href="#" onclick="window.open(window.location.origin + '/plugin/napcat-plugin-github-sub/page/config', '_blank'); return false;" style="color: #1f6feb; text-decoration: none; font-weight: 600;">WebUI 控制台</a> 
              进行管理。
            </div>
          </div>
        `)
      );
    }
  } catch (e) {
    pluginState.debug('配置 UI 初始化失败: ' + e);
  }

  // 注册 WebUI 路由和页面
  const router = (ctx as any).router;
  registerApiRoutes(router);
  router.page({ path: 'config', title: 'GitHub 订阅管理', icon: '📦', htmlFile: 'webui/config.html', description: 'GitHub 订阅配置面板' });

  // 加载配置
  if (fs.existsSync(ctx.configPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(ctx.configPath, 'utf-8'));
      pluginState.config = { ...DEFAULT_CONFIG, ...raw, subscriptions: raw.subscriptions || [], owners: raw.owners || [], tokens: raw.tokens || [] };
    } catch { /* ignore */ }
  }

  // 确保数据目录
  if (!fs.existsSync(pluginState.dataPath)) fs.mkdirSync(pluginState.dataPath, { recursive: true });

  // 加载缓存
  pluginState.loadCache();

  // 检测 Puppeteer 渲染服务
  try {
    const port = pluginState.config.webuiPort || 6099;
    const res = await fetch(`http://127.0.0.1:${port}/plugin/napcat-plugin-puppeteer/api/status`, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      pluginState.log('info', `Puppeteer 渲染服务已连接 (端口: ${port})`);
    } else {
      pluginState.log('warn', `Puppeteer 渲染服务响应异常 (HTTP ${res.status})，图片推送将降级为文本`);
    }
  } catch {
    pluginState.log('warn', '未检测到 napcat-plugin-puppeteer 插件，图片推送将降级为文本');
  }

  // 启动轮询
  if (pluginState.config.subscriptions.length > 0) {
    startPoller();
  }

  pluginState.log('info', `GitHub 订阅插件初始化完成，${pluginState.config.subscriptions.length} 个订阅`);
};

// 配置读写
export const plugin_get_config = async (): Promise<PluginConfig> => pluginState.config;
export const plugin_set_config = async (_ctx: NapCatPluginContext, _config: PluginConfig): Promise<void> => {
  // 配置通过 WebUI 管理，此处不做任何操作
};

// 清理
const plugin_cleanup: PluginModule['plugin_cleanup'] = async () => {
  stopPoller();
  pluginState.saveCache();
  pluginState.log('info', 'GitHub 订阅插件已卸载');
};

// 消息处理
const plugin_onmessage: PluginModule['plugin_onmessage'] = async (ctx: NapCatPluginContext, event: OB11Message) => {
  if (event.post_type !== 'message') return;
  const raw = (event.raw_message || '').trim();

  // 匹配前缀
  const match = raw.match(new RegExp(`^${PREFIX}\\s*(.*)`, 'is'));
  if (!match) return;

  const cmd = match[1].trim();
  const handled = await handleCommand(event, cmd, ctx);

  // 如果添加了新订阅且轮询未启动，启动轮询
  if (handled && pluginState.config.subscriptions.length > 0) {
    stopPoller();
    startPoller();
  }
};

export { plugin_init, plugin_onmessage, plugin_cleanup };
