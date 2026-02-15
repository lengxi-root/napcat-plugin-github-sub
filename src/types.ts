// GitHub 订阅插件类型定义

export type EventType = 'commits' | 'issues' | 'pulls' | 'actions';

export interface Subscription {
  /** 仓库全名 owner/repo */
  repo: string;
  /** 监控的分支（commits 用） */
  branch: string;
  /** 监控类型 */
  types: EventType[];
  /** 推送的群列表 */
  groups: string[];
  /** 是否启用 */
  enabled: boolean;
  /** 添加时间 */
  createdAt: string;
}

export interface ThemeColors {
  /** 页面背景 */
  bg: string;
  /** 卡片背景 */
  card: string;
  /** 卡片边框 */
  border: string;
  /** 分隔线 */
  divider: string;
  /** 主文字 */
  text: string;
  /** 次要文字 */
  textSub: string;
  /** 弱文字 */
  textMuted: string;
  /** diff 代码背景 */
  codeBg: string;
  /** diff 文件头背景 */
  codeHeader: string;
}

export type ThemeMode = 'light' | 'dark' | 'custom';

export interface PluginConfig {
  /** GitHub API Token（兼容旧配置，单个） */
  token: string;
  /** 多个 GitHub Token（轮询使用，提高速率限制） */
  tokens: string[];
  /** GitHub API 基础 URL */
  apiBase: string;
  /** 轮询间隔（秒） */
  interval: number;
  /** 调试模式 */
  debug: boolean;
  /** 主人 QQ 号列表 */
  owners: string[];
  /** 是否允许普通成员使用订阅指令 */
  allowMemberSub: boolean;
  /** 渲染主题 */
  theme: ThemeMode;
  /** 自定义主题色 */
  customTheme?: ThemeColors;
  /** 自定义 HTML 模板 */
  customHTML?: {
    commits?: string;
    issues?: string;
    pulls?: string;
    comments?: string;
  };
  /** 手动指定 WebUI 端口（不建议，一般自动获取） */
  webuiPort?: number;
  /** 自动识别 GitHub 仓库链接并渲染为图片 */
  autoDetectRepo: boolean;
  /** 订阅列表 */
  subscriptions: Subscription[];
}

/** 已知的最新事件 ID 缓存 */
export interface EventCache {
  /** key: `${repo}`, value: 最新事件 ID */
  [key: string]: string;
}

/** GitHub Events API 返回的事件 */
export interface GitHubEvent {
  id: string;
  type: string;
  actor: { login: string; avatar_url: string; };
  created_at: string;
  payload: Record<string, any>;
}

/** 用于渲染的 Commit 数据 */
export interface CommitData {
  sha: string;
  commit: {
    message: string;
    author: { name: string; date: string; };
    committer: { name: string; date: string; };
  };
  author: { login: string; avatar_url: string; } | null;
  html_url: string;
  /** commit 详情中的文件变更 */
  files?: CommitFile[];
}

/** Commit 文件变更 */
export interface CommitFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

/** 用于渲染的 Issue/PR 数据 */
export interface IssueData {
  number: number;
  title: string;
  state: string;
  user: { login: string; avatar_url: string; };
  created_at: string;
  updated_at: string;
  html_url: string;
  body: string | null;
  labels: { name: string; color: string; }[];
  /** 事件动作: opened / closed / reopened / merged 等 */
  action?: string;
  pull_request?: unknown;
}

/** 用于渲染的评论数据 */
export interface CommentData {
  /** Issue/PR 编号 */
  number: number;
  /** Issue/PR 标题 */
  title: string;
  /** 评论内容 */
  body: string;
  /** 评论者 */
  user: { login: string; avatar_url: string; };
  /** 评论时间 */
  created_at: string;
  /** 评论链接 */
  html_url: string;
  /** 来源类型: issue / pull_request */
  source: 'issue' | 'pull_request';
}

/** GitHub 仓库信息 */
export interface RepoInfo {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  license: { name: string; } | null;
  owner: { login: string; avatar_url: string; };
  created_at: string;
  updated_at: string;
  topics: string[];
  default_branch: string;
}

/** GitHub Actions workflow run 数据 */
export interface ActionRunData {
  id: number;
  name: string;
  head_branch: string;
  head_sha: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  actor: { login: string; avatar_url: string; };
  event: string;
  run_number: number;

  /** GitHub 仓库信息 */
  export interface RepoInfo {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  license: { name: string; } | null;
  owner: { login: string; avatar_url: string; };
  created_at: string;
  updated_at: string;
  topics: string[];
  default_branch: string;
}


}
/** GitHub 仓库信息 */
export interface RepoInfo {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  language: string | null;
  license: { name: string; } | null;
  owner: { login: string; avatar_url: string; };
  created_at: string;
  updated_at: string;
  topics: string[];
  default_branch: string;
}

