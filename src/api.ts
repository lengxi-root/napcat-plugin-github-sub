// WebUI API 路由
import type { Subscription, EventType } from './types';
import { pluginState } from './state';
import { fetchDefaultBranch } from './github';
import { stopPoller, startPoller } from './poller';

export function registerApiRoutes (router: any): void {
  // 获取配置 + 订阅列表
  router.getNoAuth('/config', (_: any, res: any) => {
    res.json({
      success: true,
      config: {
        token: pluginState.config.token ? '***' : '',
        tokens: (pluginState.config.tokens || []).map(t => t ? '***' : ''),
        tokenCount: (pluginState.config.tokens || []).filter(t => t.trim()).length + (pluginState.config.token ? 1 : 0),
        apiBase: pluginState.config.apiBase,
        interval: pluginState.config.interval,
        debug: pluginState.config.debug,
        owners: pluginState.config.owners || [],
        allowMemberSub: pluginState.config.allowMemberSub ?? false,
        theme: pluginState.config.theme || 'light',
        customTheme: pluginState.config.customTheme || null,
        customHTML: pluginState.config.customHTML || null,
      },
      subscriptions: pluginState.config.subscriptions,
    });
  });

  // 保存基础配置
  router.postNoAuth('/config', (req: any, res: any) => {
    const body = req.body as Record<string, unknown>;
    if (body.token !== undefined && body.token !== '***') pluginState.config.token = String(body.token);
    if (body.tokens !== undefined && Array.isArray(body.tokens)) {
      pluginState.config.tokens = (body.tokens as string[]).filter(t => t && t !== '***').map(String);
    }
    if (body.apiBase !== undefined) pluginState.config.apiBase = String(body.apiBase);
    if (body.interval !== undefined) {
      const n = Number(body.interval);
      if (n >= 2) pluginState.config.interval = n;
    }
    if (body.debug !== undefined) pluginState.config.debug = Boolean(body.debug);
    if (body.owners !== undefined && Array.isArray(body.owners)) {
      pluginState.config.owners = (body.owners as string[]).map(String).filter(s => s.trim());
    }
    if (body.allowMemberSub !== undefined) pluginState.config.allowMemberSub = Boolean(body.allowMemberSub);
    if (body.theme !== undefined && ['light', 'dark', 'custom'].includes(String(body.theme))) {
      pluginState.config.theme = String(body.theme) as 'light' | 'dark' | 'custom';
    }
    if (body.customTheme !== undefined && typeof body.customTheme === 'object' && body.customTheme !== null) {
      pluginState.config.customTheme = body.customTheme as any;
    }
    if (body.customHTML !== undefined && typeof body.customHTML === 'object' && body.customHTML !== null) {
      pluginState.config.customHTML = body.customHTML as any;
    }
    pluginState.saveConfig();
    stopPoller();
    startPoller();
    res.json({ success: true });
  });

  // 添加订阅
  router.postNoAuth('/sub/add', async (req: any, res: any) => {
    const { repo: rawRepo, types, groups } = req.body as { repo?: string; types?: string[]; groups?: string[]; };
    const repo = rawRepo?.trim().toLowerCase();
    if (!repo || !repo.includes('/')) { res.json({ success: false, error: '仓库格式错误，请使用 owner/repo' }); return; }

    const existing = pluginState.config.subscriptions.find(s => s.repo.toLowerCase() === repo);
    if (existing) { res.json({ success: false, error: '该仓库已订阅' }); return; }

    const validTypes: EventType[] = (types || ['commits', 'issues', 'pulls']).filter(t =>
      ['commits', 'issues', 'pulls'].includes(t)
    ) as EventType[];

    let branch = 'main';
    try { branch = await fetchDefaultBranch(repo); } catch { /* use default */ }

    const sub: Subscription = {
      repo, branch, types: validTypes,
      groups: groups || [],
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    pluginState.config.subscriptions.push(sub);
    pluginState.saveConfig();
    stopPoller();
    startPoller();
    res.json({ success: true, data: sub });
  });

  // 更新订阅
  router.postNoAuth('/sub/update', (req: any, res: any) => {
    const { repo, types, groups, enabled, branch } = req.body as Partial<Subscription> & { repo: string; };
    const sub = pluginState.config.subscriptions.find(s => s.repo === repo);
    if (!sub) { res.json({ success: false, error: '未找到该订阅' }); return; }

    if (types) sub.types = types;
    if (groups) sub.groups = groups;
    if (enabled !== undefined) sub.enabled = enabled;
    if (branch) sub.branch = branch;
    pluginState.saveConfig();
    res.json({ success: true, data: sub });
  });

  // 删除订阅
  router.postNoAuth('/sub/delete', (req: any, res: any) => {
    const { repo } = req.body as { repo?: string; };
    const idx = pluginState.config.subscriptions.findIndex(s => s.repo === repo);
    if (idx === -1) { res.json({ success: false, error: '未找到该订阅' }); return; }
    pluginState.config.subscriptions.splice(idx, 1);
    pluginState.saveConfig();
    res.json({ success: true });
  });

  // 获取群列表
  router.getNoAuth('/groups', async (_: any, res: any) => {
    try {
      if (!pluginState.actions || !pluginState.networkConfig) {
        res.json({ success: false, error: '插件未初始化' }); return;
      }
      const result = await pluginState.actions.call('get_group_list', {} as never, pluginState.adapterName, pluginState.networkConfig);
      res.json({ success: true, data: result || [] });
    } catch (e) { res.json({ success: false, error: String(e) }); }
  });

  // 切换订阅开关
  router.postNoAuth('/sub/toggle', (req: any, res: any) => {
    const { repo } = req.body as { repo?: string; };
    const sub = pluginState.config.subscriptions.find(s => s.repo === repo);
    if (!sub) { res.json({ success: false, error: '未找到该订阅' }); return; }
    sub.enabled = !sub.enabled;
    pluginState.saveConfig();
    res.json({ success: true, enabled: sub.enabled });
  });

  // Ping GitHub API 连通性测试
  router.getNoAuth('/ping', async (_: any, res: any) => {
    const base = pluginState.config.apiBase || 'https://api.github.com';
    const start = Date.now();
    try {
      const headers: Record<string, string> = { 'User-Agent': 'napcat-plugin-github-sub' };
      // 使用第一个可用 token
      const allTokens = [...(pluginState.config.tokens || [])];
      if (pluginState.config.token && !allTokens.includes(pluginState.config.token)) allTokens.push(pluginState.config.token);
      const firstToken = allTokens.find(t => t.trim());
      if (firstToken) headers['Authorization'] = `Bearer ${firstToken}`;
      const hasToken = !!firstToken;
      const r = await fetch(`${base}/zen`, { headers, signal: AbortSignal.timeout(10000) });
      const ms = Date.now() - start;

      if (r.ok) {
        res.json({ success: true, ms, status: r.status, authenticated: hasToken });
      } else {
        res.json({ success: false, ms, status: r.status, error: `HTTP ${r.status}` });
      }
    } catch (e) {
      const ms = Date.now() - start;
      res.json({ success: false, ms, error: String(e) });
    }
  });

  // Puppeteer 状态检测
  router.getNoAuth('/puppeteer', async (_: any, res: any) => {
    try {
      const port = (pluginState.networkConfig as any)?.port || 6099;
      const r = await fetch(`http://127.0.0.1:${port}/plugin/napcat-plugin-puppeteer/api/status`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) {
        res.json({ success: true, connected: true });
      } else {
        res.json({ success: true, connected: false, error: `HTTP ${r.status}` });
      }
    } catch (e) {
      res.json({ success: true, connected: false, error: String(e) });
    }
  });

  // 调试日志
  router.getNoAuth('/logs', (_: any, res: any) => {
    res.json({ success: true, data: pluginState.logBuffer });
  });

  router.postNoAuth('/logs/clear', (_: any, res: any) => {
    pluginState.clearLogs();
    res.json({ success: true });
  });
}
