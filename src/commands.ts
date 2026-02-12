// 指令处理模块
import type { NapCatPluginContext } from 'napcat-types/napcat-onebot/network/plugin-manger';
import type { OB11Message } from 'napcat-types/napcat-onebot/types/index';
import type { EventType, Subscription } from './types';
import { pluginState } from './state';
import { fetchDefaultBranch } from './github';
import { stopPoller, startPoller } from './poller';

function isOwner (userId: string): boolean {
  const owners = pluginState.config.owners || [];
  return owners.length === 0 || owners.includes(String(userId));
}

/** 是否有订阅操作权限（主人 或 allowMemberSub 开启） */
function canSub (userId: string): boolean {
  return isOwner(userId) || pluginState.config.allowMemberSub;
}

async function sendReply (event: OB11Message, text: string, ctx: NapCatPluginContext): Promise<void> {
  const msg: unknown[] = [{ type: 'text', data: { text } }];
  if (event.message_type === 'group') {
    await ctx.actions.call('send_group_msg', { group_id: event.group_id, message: msg } as never, ctx.adapterName, ctx.pluginManager.config).catch(() => { });
  } else {
    await ctx.actions.call('send_private_msg', { user_id: event.user_id, message: msg } as never, ctx.adapterName, ctx.pluginManager.config).catch(() => { });
  }
}

/** 处理指令 */
export async function handleCommand (event: OB11Message, cmd: string, ctx: NapCatPluginContext): Promise<boolean> {
  const groupId = event.group_id ? String(event.group_id) : '';
  const userId = String(event.user_id);

  // gh帮助
  if (cmd === '帮助' || cmd === '') {
    const prefix = 'gh';
    const lines: string[] = ['📦 GitHub 订阅插件', ''];
    lines.push(
      `${prefix} 帮助`,
      `${prefix} 列表`,
      `${prefix} 全部`,
    );
    if (canSub(userId)) {
      lines.push(
        `${prefix} 订阅 <owner/repo>`,
        `${prefix} 取消 <owner/repo>`,
        `${prefix} 开启/关闭 <owner/repo>`,
      );
    }
    lines.push('', '细节配置请前往 WebUI 控制台');
    await sendReply(event, lines.join('\n'), ctx);
    return true;
  }

  // gh 订阅 owner/repo
  const subMatch = cmd.match(/^订阅\s+([^\s]+)$/);
  if (subMatch) {
    if (!canSub(userId)) {
      await sendReply(event, '❌ 该指令仅主人可触发', ctx);
      return true;
    }
    const repo = subMatch[1];
    if (!repo.includes('/')) {
      await sendReply(event, '❌ 格式错误，请使用 owner/repo 格式', ctx);
      return true;
    }

    const types: EventType[] = ['commits', 'issues', 'pulls'];

    const existing = pluginState.config.subscriptions.find(s => s.repo === repo);
    if (existing) {
      if (groupId && !existing.groups.includes(groupId)) {
        existing.groups.push(groupId);
      }
      existing.enabled = true;
      pluginState.saveConfig();
      await sendReply(event, `✅ 已更新订阅 ${repo}\n推送群: ${existing.groups.join(', ')}`, ctx);
      return true;
    }

    const branch = await fetchDefaultBranch(repo);
    const sub: Subscription = {
      repo, branch, types,
      groups: groupId ? [groupId] : [],
      enabled: true,
      createdAt: new Date().toISOString(),
    };
    pluginState.config.subscriptions.push(sub);
    pluginState.saveConfig();
    await sendReply(event, `✅ 已订阅 ${repo}\n分支: ${branch}\n监控: ${types.join(', ')}\n推送群: ${sub.groups.join(', ') || '无'}`, ctx);
    return true;
  }

  // gh 取消 owner/repo
  const unsubMatch = cmd.match(/^取消\s+([^\s]+)$/);
  if (unsubMatch) {
    if (!canSub(userId)) {
      await sendReply(event, '❌ 该指令仅主人可触发', ctx);
      return true;
    }
    const repo = unsubMatch[1];
    const idx = pluginState.config.subscriptions.findIndex(s => s.repo === repo);
    if (idx === -1) {
      await sendReply(event, `❌ 未找到订阅 ${repo}`, ctx);
      return true;
    }
    if (groupId) {
      const sub = pluginState.config.subscriptions[idx];
      sub.groups = sub.groups.filter(g => g !== groupId);
      if (sub.groups.length === 0) {
        pluginState.config.subscriptions.splice(idx, 1);
        await sendReply(event, `✅ 已完全取消订阅 ${repo}`, ctx);
      } else {
        await sendReply(event, `✅ 已从本群取消订阅 ${repo}（其他群仍在推送）`, ctx);
      }
    } else {
      pluginState.config.subscriptions.splice(idx, 1);
      await sendReply(event, `✅ 已取消订阅 ${repo}`, ctx);
    }
    pluginState.saveConfig();
    return true;
  }

  // gh 列表（所有人可用）
  if (cmd === '列表') {
    const subs = pluginState.config.subscriptions.filter(s => !groupId || s.groups.includes(groupId));
    if (!subs.length) {
      await sendReply(event, '📋 当前无订阅', ctx);
      return true;
    }
    const lines = subs.map(s =>
      `${s.enabled ? '✅' : '❌'} ${s.repo} [${s.types.join(',')}] → ${s.groups.length}个群`
    );
    await sendReply(event, `📋 订阅列表 (${subs.length}个):\n${lines.join('\n')}`, ctx);
    return true;
  }

  // gh 全部（所有人可用）
  if (cmd === '全部') {
    const subs = pluginState.config.subscriptions;
    if (!subs.length) {
      await sendReply(event, '📋 当前无订阅', ctx);
      return true;
    }
    const lines = subs.map(s =>
      `${s.enabled ? '✅' : '❌'} ${s.repo} (${s.branch}) [${s.types.join(',')}] → 群:${s.groups.join(',') || '无'}`
    );
    await sendReply(event, `📋 全部订阅 (${subs.length}个):\n${lines.join('\n')}`, ctx);
    return true;
  }

  // gh 开启/关闭 owner/repo
  const toggleMatch = cmd.match(/^(开启|关闭)\s+([^\s]+)$/);
  if (toggleMatch) {
    if (!canSub(userId)) {
      await sendReply(event, '❌ 该指令仅主人可触发', ctx);
      return true;
    }
    const enable = toggleMatch[1] === '开启';
    const repo = toggleMatch[2];
    const sub = pluginState.config.subscriptions.find(s => s.repo === repo);
    if (!sub) {
      await sendReply(event, `❌ 未找到订阅 ${repo}`, ctx);
      return true;
    }
    sub.enabled = enable;
    pluginState.saveConfig();
    await sendReply(event, `✅ ${repo} 已${enable ? '开启' : '关闭'}`, ctx);
    return true;
  }

  return false;
}
