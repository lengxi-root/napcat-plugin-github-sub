// GitHub API 请求模块 - 使用 Events API（1 次请求获取所有事件类型）
import type { GitHubEvent } from './types';
import { pluginState } from './state';

/** 轮询计数器，用于多 token 轮转 */
let tokenIndex = 0;

/** 获取当前可用的 token（多 token 轮转） */
function getActiveToken (): string {
  // 合并 tokens 数组和旧的单 token 字段
  const all = [...(pluginState.config.tokens || [])];
  if (pluginState.config.token && !all.includes(pluginState.config.token)) all.push(pluginState.config.token);
  const valid = all.filter(t => t.trim());
  if (!valid.length) return '';
  const t = valid[tokenIndex % valid.length];
  tokenIndex++;
  return t;
}

function getHeaders (): Record<string, string> {
  const h: Record<string, string> = {
    'User-Agent': 'napcat-plugin-github-sub',
    'Accept': 'application/vnd.github+json',
  };
  const token = getActiveToken();
  if (token) h['Authorization'] = `Bearer ${token}`;
  return h;
}

async function fetchJSON<T> (url: string): Promise<T | null> {
  const start = Date.now();
  try {
    pluginState.debug(`[HTTP] GET ${url}`);
    pluginState.debug(`[HTTP] Headers: ${JSON.stringify({ ...getHeaders(), Authorization: pluginState.config.token ? 'Bearer ***' : undefined })}`);
    const res = await fetch(url, { headers: getHeaders() });
    const ms = Date.now() - start;

    pluginState.debug(`[HTTP] 响应: ${res.status} ${res.statusText} (${ms}ms)`);

    if (!res.ok) {
      let msg = `状态码: ${res.status} ${res.statusText || ''}`;
      switch (res.status) {
        case 401: msg = '访问令牌无效或已过期 (code: 401)'; break;
        case 403: msg = '请求达到 API 速率限制或无权限，请尝试填写 token 或降低请求频率后重试 (code: 403)'; break;
        case 404: msg = '未找到仓库 (code: 404)'; break;
        case 500: msg = '服务器错误 (code: 500)'; break;
      }
      pluginState.log('warn', `请求失败: ${url}, ${msg} (${ms}ms)`);
      return null;
    }
    const data = await res.json() as T;
    const count = Array.isArray(data) ? data.length : 1;
    pluginState.debug(`[HTTP] 解析成功: ${count} 条数据 (${ms}ms)`);
    return data;
  } catch (e) {
    const ms = Date.now() - start;
    pluginState.log('error', `请求失败: ${url} (${ms}ms)，错误信息: ${e}`);
    return null;
  }
}

/** 获取仓库事件（一次请求包含 push/issues/PR 等所有活动） */
export async function fetchEvents (repo: string, perPage = 30): Promise<GitHubEvent[]> {
  const base = pluginState.config.apiBase || 'https://api.github.com';
  const url = `${base}/repos/${repo}/events?per_page=${perPage}`;
  pluginState.debug(`[GitHub] 获取仓库事件: ${repo}`);
  const events = await fetchJSON<GitHubEvent[]>(url) || [];
  if (events.length) {
    const types = [...new Set(events.map(e => e.type))];
    pluginState.debug(`[GitHub] ${repo}: ${events.length} 条事件，类型: ${types.join(', ')}`);
  } else {
    pluginState.debug(`[GitHub] ${repo}: 无事件`);
  }
  return events;
}

/** 获取仓库默认分支 */
export async function fetchDefaultBranch (repo: string): Promise<string> {
  const base = pluginState.config.apiBase || 'https://api.github.com';
  pluginState.debug(`[GitHub] 获取默认分支: ${repo}`);
  const data = await fetchJSON<{ default_branch: string; }>(`${base}/repos/${repo}`);
  const branch = data?.default_branch || 'main';
  pluginState.debug(`[GitHub] ${repo} 默认分支: ${branch}`);
  return branch;
}

/** 获取单个 commit 的详情（含文件变更） */
export async function fetchCommitDetail (repo: string, sha: string): Promise<{ files?: any[]; } | null> {
  const base = pluginState.config.apiBase || 'https://api.github.com';
  const url = `${base}/repos/${repo}/commits/${sha}`;
  pluginState.debug(`[GitHub] 获取 commit 详情: ${repo}@${sha.slice(0, 7)}`);
  return await fetchJSON<{ files?: any[]; }>(url);
}

/** 获取仓库最近的 Actions workflow runs */
export async function fetchActionRuns (repo: string, perPage = 10): Promise<any[]> {
  const base = pluginState.config.apiBase || 'https://api.github.com';
  const url = `${base}/repos/${repo}/actions/runs?per_page=${perPage}`;
  pluginState.debug(`[GitHub] 获取 Actions runs: ${repo}`);
  const data = await fetchJSON<{ workflow_runs: any[]; }>(url);
  const runs = data?.workflow_runs || [];
  pluginState.debug(`[GitHub] ${repo}: ${runs.length} 条 Actions runs`);
  return runs;
}
