// 渲染模块 - 通过 puppeteer 插件截图 HTML 为 base64 图片
import type { CommitData, IssueData, CommentData, ThemeColors } from './types';
import { pluginState } from './state';

/** 转义 HTML */
function esc (s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 截断文本 */
function truncate (s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s;
}

/** 格式化时间 */
function fmtTime (iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// ===== 内置主题 =====
const THEME_LIGHT: ThemeColors = {
  bg: '#ffffff', card: '#f6f8fa', border: '#d0d7de', divider: '#d8dee4',
  text: '#1f2328', textSub: '#656d76', textMuted: '#8b949e',
  codeBg: '#f6f8fa', codeHeader: '#eaeef2',
};

const THEME_DARK: ThemeColors = {
  bg: '#0d1117', card: '#161b22', border: '#30363d', divider: '#21262d',
  text: '#e6edf3', textSub: '#8b949e', textMuted: '#484f58',
  codeBg: '#0d1117', codeHeader: '#1c2128',
};

/** 获取当前主题色 */
function getTheme (): ThemeColors {
  const mode = pluginState.config.theme || 'light';
  if (mode === 'dark') return THEME_DARK;
  if (mode === 'custom' && pluginState.config.customTheme) {
    return { ...THEME_LIGHT, ...pluginState.config.customTheme };
  }
  return THEME_LIGHT;
}

// ===== SVG 图标（替代 emoji，避免服务器无字体显示方块） =====
const SVG = {
  commit: `<svg width="20" height="20" viewBox="0 0 16 16" fill="#3fb950"><path d="M11.93 8.5a4.002 4.002 0 0 1-7.86 0H.75a.75.75 0 0 1 0-1.5h3.32a4.002 4.002 0 0 1 7.86 0h3.32a.75.75 0 0 1 0 1.5Zm-1.43-.25a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0Z"/></svg>`,
  issue: `<svg width="20" height="20" viewBox="0 0 16 16" fill="#8957e5"><path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/><path d="M8 0a8 8 0 1 1 0 16A8 8 0 0 1 8 0ZM1.5 8a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z"/></svg>`,
  pr: `<svg width="20" height="20" viewBox="0 0 16 16" fill="#db6d28"><path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>`,
  dotOpen: `<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#3fb950"/></svg>`,
  dotClosed: `<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#f85149"/></svg>`,
  dotMerged: `<svg width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5" fill="#a371f7"/></svg>`,
  // comment icon (Octicons - comment-discussion)
  comment: `<svg width="20" height="20" viewBox="0 0 16 16" fill="#58a6ff"><path d="M1.75 1h8.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 10.25 10H7.061l-2.574 2.573A1.458 1.458 0 0 1 2 11.543V10h-.25A1.75 1.75 0 0 1 0 8.25v-5.5C0 1.784.784 1 1.75 1ZM1.5 2.75v5.5c0 .138.112.25.25.25h1a.75.75 0 0 1 .75.75v2.19l2.72-2.72a.749.749 0 0 1 .53-.22h3.5a.25.25 0 0 0 .25-.25v-5.5a.25.25 0 0 0-.25-.25h-8.5a.25.25 0 0 0-.25.25Zm13 2a.25.25 0 0 0-.25-.25h-.5a.75.75 0 0 1 0-1.5h.5c.966 0 1.75.784 1.75 1.75v5.5A1.75 1.75 0 0 1 14.25 12H14v1.543a1.458 1.458 0 0 1-2.487 1.03L9.22 12.28a.749.749 0 0 1 .326-1.275.749.749 0 0 1 .734.215l2.22 2.22v-2.19a.75.75 0 0 1 .75-.75h1a.25.25 0 0 0 .25-.25Z"/></svg>`,
};

/** 调用 puppeteer 插件渲染 HTML 为 base64 图片 */
async function renderToBase64 (html: string): Promise<string | null> {
  try {
    const port = (pluginState.networkConfig as any)?.port || 6099;
    const host = `http://127.0.0.1:${port}`;
    const url = `${host}/plugin/napcat-plugin-puppeteer/api/render`;

    pluginState.debug(`调用 puppeteer 渲染，HTML 长度: ${html.length}`);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html,
        file_type: 'htmlString',
        selector: 'body',
        type: 'png',
        encoding: 'base64',
        setViewport: { width: 600, height: 100 },
      }),
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json() as { code: number; data?: string; message?: string; };
    if (data.code === 0 && data.data) {
      pluginState.debug('puppeteer 渲染成功');
      return data.data;
    }
    pluginState.log('warn', `puppeteer 渲染失败: ${data.message || '未知错误'}`);
    return null;
  } catch (e) {
    pluginState.log('error', `puppeteer 渲染请求失败: ${e}`);
    return null;
  }
}

/** 通用 HTML 模板（主题驱动） */
function wrapHTML (repo: string, typeName: string, color: string, icon: string, count: number, content: string): string {
  const t = getTheme();
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:${t.bg};color:${t.text};padding:20px;width:600px}
.card{background:${t.card};border:1px solid ${t.border};border-radius:12px;overflow:hidden}
.header{padding:16px 20px;border-bottom:1px solid ${t.border};display:flex;align-items:center;gap:12px}
.header-icon{display:flex;align-items:center}
.header-info h2{font-size:16px;font-weight:600;color:${t.text}}
.header-info .repo{font-size:13px;color:${t.textSub};margin-top:2px}
.badge{background:${color}20;color:${color};border:1px solid ${color}40;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:500;margin-left:auto}
.body{padding:12px 20px}
.item{padding:10px 0;border-bottom:1px solid ${t.divider}}
.item:last-child{border-bottom:none}
.item-header{display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:12px}
.sha{background:${t.border};color:#7ee787;padding:1px 6px;border-radius:4px;font-family:monospace;font-size:11px}
.author{color:${t.textSub}}
.time{color:${t.textMuted};margin-left:auto;font-size:11px}
.msg{font-size:13px;color:${t.text};line-height:1.5}
.label{display:inline-block;padding:0 6px;border-radius:8px;font-size:11px;margin-left:4px}
.footer{padding:10px 20px;border-top:1px solid ${t.border};text-align:center;font-size:11px;color:${t.textMuted}}
.diff-file{margin-top:8px;border:1px solid ${t.border};border-radius:6px;overflow:hidden}
.diff-name{padding:4px 10px;background:${t.codeHeader};font-size:11px;font-family:monospace;color:${t.textSub};display:flex;align-items:center;gap:6px;border-bottom:1px solid ${t.border}}
.diff-name .add{color:#3fb950}.diff-name .del{color:#f85149}
.diff-code{padding:6px 10px;font-family:monospace;font-size:10px;line-height:1.6;white-space:pre-wrap;word-break:break-all;background:${t.codeBg};color:${t.textSub}}
.diff-code .l-add{color:#3fb950;background:rgba(63,185,80,.1)}
.diff-code .l-del{color:#f85149;background:rgba(248,81,73,.1)}
.diff-code .l-hunk{color:#79c0ff}
.diff-more{padding:6px 10px;font-size:10px;color:${t.textSub};text-align:center;background:${t.codeBg};border-top:1px solid ${t.divider}}
.st-dot{display:inline-flex;align-items:center;vertical-align:middle;margin-right:2px}
.action-tag{display:inline-block;padding:1px 6px;border-radius:4px;font-size:10px;font-weight:500;margin-left:6px}
</style></head><body>
<div class="card">
  <div class="header">
    <span class="header-icon">${icon}</span>
    <div class="header-info"><h2>${typeName} 更新</h2><div class="repo">${esc(repo)}</div></div>
    <span class="badge">${count} 条新更新</span>
  </div>
  <div class="body">${content}</div>
  <div class="footer">GitHub Subscription · ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</div>
</div>
</body></html>`;
}

/** 渲染 patch 内容为带颜色的 diff */
function renderPatch (patch: string, maxChars: number): string {
  const lines = patch.split('\n');
  let charCount = 0;
  let truncated = false;
  const rendered: string[] = [];
  for (const line of lines) {
    if (charCount + line.length > maxChars) { truncated = true; break; }
    charCount += line.length + 1;
    const escaped = esc(line);
    if (line.startsWith('+')) rendered.push(`<div class="l-add">${escaped}</div>`);
    else if (line.startsWith('-')) rendered.push(`<div class="l-del">${escaped}</div>`);
    else if (line.startsWith('@@')) rendered.push(`<div class="l-hunk">${escaped}</div>`);
    else rendered.push(`<div>${escaped}</div>`);
  }
  if (truncated) rendered.push(`<div style="color:#8b949e;font-style:italic">... 内容过长已截断</div>`);
  return rendered.join('');
}

/** 生成单个文件的 diff HTML */
function fileDiffHTML (file: { filename: string; status: string; additions: number; deletions: number; patch?: string; }): string {
  const patchContent = file.patch ? renderPatch(file.patch, 300) : '<div style="color:#8b949e">（二进制文件或无变更内容）</div>';
  return `<div class="diff-file"><div class="diff-name"><span>${esc(file.filename)}</span><span class="add">+${file.additions}</span><span class="del">-${file.deletions}</span></div><div class="diff-code">${patchContent}</div></div>`;
}

/** 生成 Commits HTML（含 diff） */
function commitsHTML (repo: string, commits: CommitData[]): string {
  const rows = commits.map(c => {
    const msg = esc(truncate(c.commit.message.split('\n')[0], 80));
    const author = esc(c.commit.author.name);
    const sha = c.sha.slice(0, 7);
    const time = fmtTime(c.commit.author.date);
    let diffHtml = '';
    if (c.files && c.files.length) {
      const show = c.files.slice(0, 5);
      const rest = c.files.length - show.length;
      diffHtml = show.map(f => fileDiffHTML(f)).join('');
      if (rest > 0) diffHtml += `<div class="diff-more">还有 ${rest} 个文件变更，请进入项目中查阅</div>`;
    }
    return `<div class="item"><div class="item-header"><span class="sha">${sha}</span><span class="author">${author}</span><span class="time">${time}</span></div><div class="msg">${msg}</div>${diffHtml}</div>`;
  }).join('');
  return wrapHTML(repo, 'Commits', '#2ea44f', SVG.commit, commits.length, rows);
}

/** 动作标签映射 */
const ACTION_MAP: Record<string, { text: string; color: string; bg: string; }> = {
  opened: { text: '新建', color: '#3fb950', bg: 'rgba(63,185,80,.15)' },
  closed: { text: '关闭', color: '#f85149', bg: 'rgba(248,81,73,.15)' },
  reopened: { text: '重新打开', color: '#d29922', bg: 'rgba(210,153,34,.15)' },
  merged: { text: '已合并', color: '#a371f7', bg: 'rgba(163,113,247,.15)' },
};

function actionTag (action?: string): string {
  if (!action) return '';
  const a = ACTION_MAP[action];
  if (!a) return `<span class="action-tag" style="background:rgba(139,148,158,.15);color:#8b949e">${esc(action)}</span>`;
  return `<span class="action-tag" style="background:${a.bg};color:${a.color}">${a.text}</span>`;
}

/** 生成 Issues HTML */
function issuesHTML (repo: string, issues: IssueData[]): string {
  const rows = issues.map(i => {
    const title = esc(truncate(i.title, 80));
    const author = esc(i.user.login);
    const time = fmtTime(i.created_at);
    const dot = i.state === 'open' ? SVG.dotOpen : SVG.dotClosed;
    const labels = i.labels.map(l => `<span class="label" style="background:#${l.color}20;color:#${l.color};border:1px solid #${l.color}40">${esc(l.name)}</span>`).join('');
    const tag = actionTag(i.action);
    return `<div class="item"><div class="item-header"><span class="st-dot">${dot}</span><span style="color:${i.state === 'open' ? '#3fb950' : '#f85149'}">#${i.number}</span>${tag}<span class="author">${author}</span><span class="time">${time}</span></div><div class="msg">${title} ${labels}</div></div>`;
  }).join('');
  return wrapHTML(repo, 'Issues', '#8957e5', SVG.issue, issues.length, rows);
}

/** 生成 Pull Requests HTML */
function pullsHTML (repo: string, pulls: IssueData[]): string {
  const rows = pulls.map(p => {
    const title = esc(truncate(p.title, 80));
    const author = esc(p.user.login);
    const time = fmtTime(p.created_at);
    const dot = p.state === 'open' ? SVG.dotOpen : p.state === 'merged' ? SVG.dotMerged : SVG.dotClosed;
    const stateColor = p.state === 'open' ? '#3fb950' : p.state === 'merged' ? '#a371f7' : '#f85149';
    const tag = actionTag(p.action);
    return `<div class="item"><div class="item-header"><span class="st-dot">${dot}</span><span style="color:${stateColor}">#${p.number}</span>${tag}<span class="author">${author}</span><span class="time">${time}</span></div><div class="msg">${title}</div></div>`;
  }).join('');
  return wrapHTML(repo, 'Pull Requests', '#db6d28', SVG.pr, pulls.length, rows);
}

/** 生成 Comments HTML */
function commentsHTML (repo: string, comments: CommentData[]): string {
  const rows = comments.map(c => {
    const body = esc(truncate(c.body.replace(/\n/g, ' '), 120));
    const author = esc(c.user.login);
    const time = fmtTime(c.created_at);
    const sourceIcon = c.source === 'pull_request' ? SVG.pr : SVG.issue;
    const title = esc(truncate(c.title, 60));
    return `<div class="item"><div class="item-header"><span class="st-dot">${sourceIcon}</span><span style="color:#58a6ff">#${c.number}</span><span style="font-size:11px;color:${getTheme().textSub}">${title}</span><span class="time">${time}</span></div><div class="msg"><span class="author">${author}</span>: ${body}</div></div>`;
  }).join('');
  return wrapHTML(repo, 'Comments', '#58a6ff', SVG.comment, comments.length, rows);
}

/** 文本摘要（降级用） */
export function commitsSummary (repo: string, commits: CommitData[]): string {
  const lines = [`[${repo}] ${commits.length} 条新 Commit\n`];
  for (const c of commits) {
    const msg = c.commit.message.split('\n')[0].slice(0, 60);
    lines.push(`* ${c.sha.slice(0, 7)} ${c.commit.author.name}: ${msg}`);
  }
  return lines.join('\n');
}

export function issuesSummary (repo: string, issues: IssueData[], type: 'Issues' | 'Pull Requests'): string {
  const lines = [`[${repo}] ${issues.length} 条新 ${type}\n`];
  for (const i of issues) {
    const actionText = i.action ? `[${i.action}]` : (i.state === 'open' ? '[open]' : '[closed]');
    lines.push(`${actionText} #${i.number} ${i.title.slice(0, 50)} - ${i.user.login}`);
  }
  return lines.join('\n');
}

export function commentsSummary (repo: string, comments: CommentData[]): string {
  const lines = [`[${repo}] ${comments.length} 条新评论\n`];
  for (const c of comments) {
    const src = c.source === 'pull_request' ? 'PR' : 'Issue';
    lines.push(`[${src}#${c.number}] ${c.user.login}: ${c.body.replace(/\n/g, ' ').slice(0, 60)}`);
  }
  return lines.join('\n');
}

/** 自定义模板变量替换 */
function tplReplace (tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/** 构建 commits 的模板变量 */
function commitsTplVars (repo: string, commits: CommitData[]): Record<string, string> {
  const itemsJson = JSON.stringify(commits.map(c => ({
    sha: c.sha, sha7: c.sha.slice(0, 7),
    message: c.commit.message.split('\n')[0],
    author: c.commit.author.name, date: c.commit.author.date,
    url: c.html_url,
    files: (c.files || []).map(f => ({ filename: f.filename, status: f.status, additions: f.additions, deletions: f.deletions, patch: f.patch || '' })),
  })));
  return {
    repo, count: String(commits.length), type: 'Commits',
    time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    items: itemsJson,
  };
}

/** 构建 issues/pulls 的模板变量 */
function issuesTplVars (repo: string, items: IssueData[], type: string): Record<string, string> {
  const itemsJson = JSON.stringify(items.map(i => ({
    number: i.number, title: i.title, state: i.state, action: i.action || '',
    author: i.user.login, created_at: i.created_at, url: i.html_url,
    labels: i.labels.map(l => ({ name: l.name, color: l.color })),
  })));
  return {
    repo, count: String(items.length), type,
    time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
    items: itemsJson,
  };
}

/** 渲染 Commits 并返回 base64 图片（失败返回 null） */
export async function renderCommits (repo: string, commits: CommitData[]): Promise<string | null> {
  const custom = pluginState.config.customHTML?.commits;
  if (custom) {
    pluginState.debug('[渲染] 使用自定义 Commits 模板');
    return renderToBase64(tplReplace(custom, commitsTplVars(repo, commits)));
  }
  return renderToBase64(commitsHTML(repo, commits));
}

/** 渲染 Issues */
export async function renderIssues (repo: string, issues: IssueData[]): Promise<string | null> {
  const custom = pluginState.config.customHTML?.issues;
  if (custom) {
    pluginState.debug('[渲染] 使用自定义 Issues 模板');
    return renderToBase64(tplReplace(custom, issuesTplVars(repo, issues, 'Issues')));
  }
  return renderToBase64(issuesHTML(repo, issues));
}

/** 渲染 Pull Requests */
export async function renderPulls (repo: string, pulls: IssueData[]): Promise<string | null> {
  const custom = pluginState.config.customHTML?.pulls;
  if (custom) {
    pluginState.debug('[渲染] 使用自定义 Pulls 模板');
    return renderToBase64(tplReplace(custom, issuesTplVars(repo, pulls, 'Pull Requests')));
  }
  return renderToBase64(pullsHTML(repo, pulls));
}

/** 渲染 Comments */
export async function renderComments (repo: string, comments: CommentData[]): Promise<string | null> {
  const custom = pluginState.config.customHTML?.comments;
  if (custom) {
    pluginState.debug('[渲染] 使用自定义 Comments 模板');
    const itemsJson = JSON.stringify(comments.map(c => ({
      number: c.number, title: c.title, body: c.body, author: c.user.login,
      created_at: c.created_at, url: c.html_url, source: c.source,
    })));
    return renderToBase64(tplReplace(custom, {
      repo, count: String(comments.length), type: 'Comments',
      time: new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }),
      items: itemsJson,
    }));
  }
  return renderToBase64(commentsHTML(repo, comments));
}
