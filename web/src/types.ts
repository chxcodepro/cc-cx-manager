export type Platform = 'windows' | 'macos' | 'linux';

export type ItemType =
  | 'boolean' | 'string' | 'integer' | 'number' | 'enum' | 'string[]' | 'enum[]'
  | 'map' | 'record' | 'group' | 'json';

export interface EnumOption {
  value: string | number | boolean;
  label?: string;
  description?: string;
  en?: string;
}

export interface Item {
  key: string;
  /** 记录型字段在目录中的完整键（如 mcp_servers.*.env_vars），key 此时是相对键 */
  fullKey?: string;
  title: string;
  category: string;
  type: ItemType;
  description?: string;
  /** 一句话说明：改这个参数有什么效果（「?」弹出层中优先显示） */
  brief?: string;
  en?: string;
  enum?: EnumOption[];
  default?: unknown;
  defaultNote?: string;
  recommended?: unknown;
  recommendedByPlatform?: Partial<Record<Platform, unknown>>;
  recommendedReason?: string;
  example?: unknown;
  placeholder?: string;
  unit?: string;
  min?: number;
  max?: number;
  scopes?: string[];
  tags?: string[];
  deprecated?: boolean;
  deprecatedNote?: string;
  replacedBy?: string;
  since?: string;
  sensitive?: boolean;
  envTrue?: string;
  envFalse?: string;
  platforms?: Platform[];
  platformNotes?: Partial<Record<Platform, string>>;
  docUrl?: string;
  stage?: string;
  fieldKeys?: string[];
  untranslated?: boolean;
  union?: string;
  aliasOf?: string;
  featureName?: string;
}

export interface Category {
  id: string;
  name: string;
  order: number;
  description?: string;
}

export interface Catalog {
  name: string;
  product: 'claude' | 'codex';
  title: string;
  meta: { name: string; version?: string; source?: string; from?: string; generatedAt?: string; bundledVersion?: string }[];
  categories: Category[];
  items: Item[];
  stats: { total: number; untranslated: number };
}

export interface Target {
  id: string;
  product: 'claude' | 'codex';
  format: 'json' | 'toml' | 'dotenv';
  scope: 'user' | 'project' | 'local' | 'managed';
  catalog: string;
  label: string;
  desc: string;
  path: string | null;
  requiresProject?: boolean;
  system?: boolean;
  /** 参数在文件中的位置前缀（如 ~/.claude.json 中的 projects.<路径>） */
  dataPrefix?: string[];
  /** 会被程序频繁改写的文件：保存时合并修改 */
  live?: boolean;
  /** 不提供原始文本编辑 */
  rawDisabled?: boolean;
  exists?: boolean;
  writable?: boolean;
  size?: number;
  mtimeMs?: number;
}

export interface FileState extends Target {
  text: string;
  data: Record<string, unknown> | null;
  hash: string;
  parseError?: string;
}

export interface AppState {
  platform: Platform;
  wsl: boolean;
  node: string;
  home: string;
  appData: string;
  claudeDir: string;
  codexHome: string;
  projectDir: string | null;
  recentProjects: string[];
  targets: Target[];
  catalogs: Record<string, { stats: { total: number; untranslated: number }; meta: Catalog['meta'] }>;
}

export interface DiffOp { t: ' ' | '+' | '-'; s: string; a?: number; b?: number }
export interface DiffResult { hunks: DiffOp[][]; added: number; removed: number }

export interface VersionInfo {
  name: string;
  bin: string | null;
  installed: string | null;
  latest: string | null;
  registry: string | null;
  outdated: boolean;
  install: string;
  updateCommands: { label: string; cmd: string }[];
}

export type Op = { op: 'set'; path: string[]; value: unknown } | { op: 'unset'; path: string[] } | { op: 'rename'; path: string[]; to: string };
