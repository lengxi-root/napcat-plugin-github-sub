// 默认配置
import type { PluginConfig } from './types';

export const DEFAULT_CONFIG: PluginConfig = {
  token: '',
  tokens: [],
  apiBase: 'https://api.github.com',
  interval: 30,
  debug: false,
  owners: [],
  allowMemberSub: true,
  theme: 'light',
  subscriptions: [],
};
