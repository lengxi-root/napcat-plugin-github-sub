// 轮询模块 - 使用 Events API，每个仓库只需 1 次请求
import type { GitHubEvent, CommitData, IssueData, CommentData, ActionRunData, EventType } from './types';
import { pluginState } from './state';
import { fetchEvents, fetchCommitDetail, fetchActionRuns } from './github';
import { renderCommits, renderIssues, renderPulls, renderComments, renderActions, commitsSummary, issuesSummary, commentsSummary, actionsSummary } from './render';

/** 发送 base64 图片消息到群，失败则降级为文本 */
async function sendImage (groupId: string, base64: string | null, fallbackText: string): Promise<void> {
  if (base64) {
    try {
      pluginState.debug(`[推送] 发送图片到群 ${groupId}，base64 长度: ${base64.length}`);
      await pluginState.sendGroupMsg(groupId, [
        { type: 'image', data: { file: `base64://${base64}` } }
      ]);
      pluginState.debug(`[推送] 图片发送成功: 群 ${groupId}`);
      return;
    } catch (e) {
      pluginState.debug(`[推送] 图片发送失败: 群 ${groupId}，错误: ${e}，降级为文本`);
    }
  } else {
    pluginState.debug(`[推送] 渲染失败，使用文本降级: 群 ${groupId}`);
  }
  await pluginState.sendGroupMsg(groupId, [{ type: 'text', data: { text: fallbackText } }]);
}

/** 从 PushEvent 提取 CommitData */
function extractCommits (events: GitHubEvent[], branch: string): CommitData[] {
  const commits: CommitData[] = [];
  for (const ev of events) {
    if (ev.type !== 'PushEvent') continue;
    const ref = ev.payload.ref as string || '';
    if (branch && !ref.endsWith(`/${branch}`)) continue;
    const payloadCommits = ev.payload.commits as any[] || [];
    if (payloadCommits.length) {
      for (const c of payloadCommits) {
        commits.push({
          sha: c.sha,
          commit: {
            message: c.message || '',
            author: { name: c.author?.name || ev.actor.login, date: ev.created_at },
            committer: { name: c.author?.name || ev.actor.login, date: ev.created_at },
          },
          author: { login: ev.actor.login, avatar_url: ev.actor.avatar_url },
          html_url: `https://github.com/${ev.payload.repo || ''}/commit/${c.sha}`,
        });
      }
    } else if (ev.payload.head) {
      // payload.commits 为空时（web 操作等），用 head sha 构造
      const sha = ev.payload.head as string;
      commits.push({
        sha,
        commit: {
          message: `Push to ${ref.replace('refs/heads/', '')}`,
          author: { name: ev.actor.login, date: ev.created_at },
          committer: { name: ev.actor.login, date: ev.created_at },
        },
        author: { login: ev.actor.login, avatar_url: ev.actor.avatar_url },
        html_url: `https://github.com/${ev.payload.repo || ''}/commit/${sha}`,
      });
    }
  }
  return commits;
}

/** 从 IssuesEvent 提取 IssueData */
function extractIssues (events: GitHubEvent[]): IssueData[] {
  const issues: IssueData[] = [];
  const seen = new Set<number>();
  for (const ev of events) {
    if (ev.type !== 'IssuesEvent') continue;
    const i = ev.payload.issue as any;
    if (!i || seen.has(i.number)) continue;
    seen.add(i.number);
    issues.push({
      number: i.number,
      title: i.title || '',
      state: i.state || 'open',
      user: { login: i.user?.login || ev.actor.login, avatar_url: i.user?.avatar_url || '' },
      created_at: i.created_at || ev.created_at,
      updated_at: i.updated_at || ev.created_at,
      html_url: i.html_url || '',
      body: i.body || null,
      labels: (i.labels || []).map((l: any) => ({ name: l.name || '', color: l.color || '888888' })),
      action: ev.payload.action as string || undefined,
    });
  }
  return issues;
}

/** 从 PullRequestEvent 提取 IssueData */
function extractPulls (events: GitHubEvent[]): IssueData[] {
  const pulls: IssueData[] = [];
  const seen = new Set<number>();
  for (const ev of events) {
    if (ev.type !== 'PullRequestEvent') continue;
    const p = ev.payload.pull_request as any;
    if (!p || seen.has(p.number)) continue;
    seen.add(p.number);
    pulls.push({
      number: p.number,
      title: p.title || '',
      state: p.merged ? 'merged' : (p.state || 'open'),
      user: { login: p.user?.login || ev.actor.login, avatar_url: p.user?.avatar_url || '' },
      created_at: p.created_at || ev.created_at,
      updated_at: p.updated_at || ev.created_at,
      html_url: p.html_url || '',
      body: p.body || null,
      labels: (p.labels || []).map((l: any) => ({ name: l.name || '', color: l.color || '888888' })),
      action: p.merged ? 'merged' : (ev.payload.action as string || undefined),
      pull_request: true,
    });
  }
  return pulls;
}

/** 从 IssueCommentEvent / PullRequestReviewCommentEvent 提取评论 */
function extractComments (events: GitHubEvent[]): CommentData[] {
  const comments: CommentData[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.type !== 'IssueCommentEvent' && ev.type !== 'PullRequestReviewCommentEvent') continue;
    const comment = ev.payload.comment as any;
    if (!comment) continue;
    const key = String(comment.id);
    if (seen.has(key)) continue;
    seen.add(key);
    const issue = ev.payload.issue as any;
    const pr = ev.payload.pull_request as any;
    const target = issue || pr;
    comments.push({
      number: target?.number || 0,
      title: target?.title || '',
      body: comment.body || '',
      user: { login: comment.user?.login || ev.actor.login, avatar_url: comment.user?.avatar_url || '' },
      created_at: comment.created_at || ev.created_at,
      html_url: comment.html_url || '',
      source: ev.type === 'PullRequestReviewCommentEvent' ? 'pull_request' : 'issue',
    });
  }
  return comments;
}

/** 检查单个仓库的所有事件（1 次 API 请求） */
async function checkRepo (repo: string, branch: string, types: EventType[], groups: string[]): Promise<void> {
  const cacheKey = repo;
  pluginState.debug(`[轮询] 检查仓库: ${repo} (分支: ${branch}, 类型: ${types.join(',')}, 群: ${groups.join(',')})`);

  const events = await fetchEvents(repo);
  if (!events.length) {
    pluginState.debug(`[轮询] ${repo}: 无事件，跳过`);
    return;
  }

  const latestId = events[0].id;
  const lastKnown = pluginState.cache[cacheKey];

  pluginState.debug(`[轮询] ${repo}: 最新事件 ID=${latestId}, 缓存 ID=${lastKnown || '无'}`);

  // 首次运行，只记录不推送
  if (!lastKnown) {
    pluginState.cache[cacheKey] = latestId;
    pluginState.saveCache();
    pluginState.log('info', `[${repo}] 首次运行，记录最新事件 ID: ${latestId}，不推送`);
    return;
  }

  // 没有更新
  if (lastKnown === latestId) {
    pluginState.debug(`[轮询] ${repo}: 无更新`);
    return;
  }

  // 找出新事件
  const lastIdx = events.findIndex(e => e.id === lastKnown);
  const newEvents = lastIdx > 0 ? events.slice(0, lastIdx) : events.slice(0, 10);

  if (!newEvents.length) {
    pluginState.debug(`[轮询] ${repo}: 新事件列表为空，跳过`);
    return;
  }

  // 更新缓存
  pluginState.cache[cacheKey] = latestId;
  pluginState.saveCache();

  const eventTypes = [...new Set(newEvents.map(e => e.type))];
  pluginState.log('info', `[${repo}] 发现 ${newEvents.length} 条新事件: ${eventTypes.join(', ')}`);

  // 按类型分类并推送
  if (types.includes('commits')) {
    const commits = extractCommits(newEvents, branch);
    pluginState.debug(`[轮询] ${repo}: 提取到 ${commits.length} 条 Commit`);
    if (commits.length) {
      // 获取每个 commit 的文件变更详情
      for (const c of commits) {
        try {
          const detail = await fetchCommitDetail(repo, c.sha);
          if (detail?.files) {
            c.files = detail.files.map((f: any) => ({
              filename: f.filename || '',
              status: f.status || '',
              additions: f.additions || 0,
              deletions: f.deletions || 0,
              patch: f.patch || undefined,
            }));
            pluginState.debug(`[轮询] ${c.sha.slice(0, 7)}: ${c.files.length} 个文件变更`);
          }
        } catch { /* 获取详情失败不影响推送 */ }
      }
      pluginState.log('info', `[${repo}] 推送 ${commits.length} 条新 Commit 到 ${groups.length} 个群`);
      const base64 = await renderCommits(repo, commits);
      pluginState.debug(`[渲染] Commits 渲染结果: ${base64 ? '成功' : '失败'}`);
      const fallback = commitsSummary(repo, commits);
      for (const gid of groups) await sendImage(gid, base64, fallback);
    }
  }

  if (types.includes('issues')) {
    const issues = extractIssues(newEvents);
    pluginState.debug(`[轮询] ${repo}: 提取到 ${issues.length} 条 Issue`);
    if (issues.length) {
      pluginState.log('info', `[${repo}] 推送 ${issues.length} 条新 Issue 到 ${groups.length} 个群`);
      const base64 = await renderIssues(repo, issues);
      pluginState.debug(`[渲染] Issues 渲染结果: ${base64 ? '成功' : '失败'}`);
      const fallback = issuesSummary(repo, issues, 'Issues');
      for (const gid of groups) await sendImage(gid, base64, fallback);
    }
  }

  if (types.includes('pulls')) {
    const pulls = extractPulls(newEvents);
    pluginState.debug(`[轮询] ${repo}: 提取到 ${pulls.length} 条 PR`);
    if (pulls.length) {
      pluginState.log('info', `[${repo}] 推送 ${pulls.length} 条新 PR 到 ${groups.length} 个群`);
      const base64 = await renderPulls(repo, pulls);
      pluginState.debug(`[渲染] PRs 渲染结果: ${base64 ? '成功' : '失败'}`);
      const fallback = issuesSummary(repo, pulls, 'Pull Requests');
      for (const gid of groups) await sendImage(gid, base64, fallback);
    }
  }

  // 评论推送：跟随 issues/pulls 自动订阅
  const wantIssueComments = types.includes('issues');
  const wantPrComments = types.includes('pulls');
  if (wantIssueComments || wantPrComments) {
    let comments = extractComments(newEvents);
    // 按来源过滤
    if (!wantIssueComments) comments = comments.filter(c => c.source === 'pull_request');
    if (!wantPrComments) comments = comments.filter(c => c.source === 'issue');
    pluginState.debug(`[轮询] ${repo}: 提取到 ${comments.length} 条评论`);
    if (comments.length) {
      pluginState.log('info', `[${repo}] 推送 ${comments.length} 条新评论到 ${groups.length} 个群`);
      const base64 = await renderComments(repo, comments);
      pluginState.debug(`[渲染] Comments 渲染结果: ${base64 ? '成功' : '失败'}`);
      const fallback = commentsSummary(repo, comments);
      for (const gid of groups) await sendImage(gid, base64, fallback);
    }
  }

  // Actions 监控（独立 API，不走 Events）
  if (types.includes('actions')) {
    const actionsCacheKey = `${repo}:actions`;
    pluginState.debug(`[轮询] ${repo}: 检查 Actions runs`);
    const runs = await fetchActionRuns(repo);
    if (runs.length) {
      const latestRunId = String(runs[0].id);
      const lastKnownRun = pluginState.cache[actionsCacheKey];
      if (!lastKnownRun) {
        pluginState.cache[actionsCacheKey] = latestRunId;
        pluginState.saveCache();
        pluginState.log('info', `[${repo}] Actions 首次运行，记录最新 run ID: ${latestRunId}`);
      } else if (lastKnownRun !== latestRunId) {
        const lastIdx = runs.findIndex(r => String(r.id) === lastKnownRun);
        const newRuns: ActionRunData[] = (lastIdx > 0 ? runs.slice(0, lastIdx) : runs.slice(0, 10)).map((r: any) => ({
          id: r.id, name: r.name || r.display_title || '', head_branch: r.head_branch || '',
          head_sha: r.head_sha || '', status: r.status || '', conclusion: r.conclusion || null,
          html_url: r.html_url || '', created_at: r.created_at || '', updated_at: r.updated_at || '',
          actor: { login: r.actor?.login || '', avatar_url: r.actor?.avatar_url || '' },
          event: r.event || '', run_number: r.run_number || 0,
        }));
        pluginState.cache[actionsCacheKey] = latestRunId;
        pluginState.saveCache();
        if (newRuns.length) {
          pluginState.log('info', `[${repo}] 推送 ${newRuns.length} 条 Actions 更新到 ${groups.length} 个群`);
          const base64 = await renderActions(repo, newRuns);
          const fallback = actionsSummary(repo, newRuns);
          for (const gid of groups) await sendImage(gid, base64, fallback);
        }
      }
    }
  }
}

/** 执行一次完整轮询 */
export async function poll (): Promise<void> {
  const activeSubs = pluginState.config.subscriptions.filter(s => s.enabled && s.groups.length);
  pluginState.debug(`[定时] 开始轮询，共 ${activeSubs.length} 个活跃订阅`);
  const start = Date.now();

  for (const sub of activeSubs) {
    try {
      await checkRepo(sub.repo, sub.branch, sub.types, sub.groups);
    } catch (e) {
      pluginState.log('error', `轮询 ${sub.repo} 失败: ${e}`);
    }
  }

  const ms = Date.now() - start;
  pluginState.debug(`[定时] 轮询完成，耗时 ${ms}ms`);
}

/** 启动轮询 */
export function startPoller (): void {
  const sec = Math.max(pluginState.config.interval || 30, 5);
  pluginState.log('info', `轮询已启动，间隔 ${sec} 秒，共 ${pluginState.config.subscriptions.length} 个订阅`);
  pluginState.setPollTimer(setInterval(() => poll().catch(() => { }), sec * 1000));
}

/** 停止轮询 */
export function stopPoller (): void {
  pluginState.clearPollTimer();
  pluginState.log('info', '轮询已停止');
}
