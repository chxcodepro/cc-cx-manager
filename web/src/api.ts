import type { AppState, Catalog, DiffResult, FileState, Op, VersionInfo } from './types';

declare global {
  interface Window {
    ccm?: {
      invoke: (method: string, payload?: unknown) => Promise<{ ok: boolean; data?: unknown; error?: string; status?: number; code?: string | null }>;
      platform: string;
    };
  }
}

export class ApiError extends Error {
  status: number;
  code: string | null;
  constructor(status: number, message: string, code: string | null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** 是否运行在桌面程序中（界面只通过 Electron IPC 读写配置） */
export const isDesktop = typeof window !== 'undefined' && !!window.ccm;

async function call<T>(method: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (!window.ccm) throw new ApiError(500, '请在桌面程序中打开', null);
  const r = await window.ccm.invoke(method, payload);
  if (!r.ok) throw new ApiError(r.status || 500, r.error || '操作失败', r.code ?? null);
  return r.data as T;
}

export const api = {
  state: () => call<AppState>('state'),
  catalog: (name: string) => call<Catalog>('catalog', { name }),
  file: (id: string) => call<FileState>('file', { id }),
  preview: (id: string, body: { ops?: Op[]; text?: string; baseHash?: string }) =>
    call<{ existed: boolean; before: string; after: string; changed: boolean; diff: DiffResult }>('preview', { id, ...body }),
  save: (id: string, body: { ops?: Op[]; text?: string; baseHash?: string; reason?: string }) =>
    call<{ changed: boolean; hash: string; backup?: string | null; file: FileState }>('save', { id, ...body }),
  backups: (id: string) => call<{ name: string; size: number; time: number; reason: string }[]>('backups', { id }),
  backup: (id: string, name: string) => call<{ text: string; diff: DiffResult }>('backup', { id, name }),
  restore: (id: string, name: string) => call<{ hash: string; file: FileState }>('restore', { id, name }),
  versions: (refresh = false) => call<Record<'claude' | 'codex', VersionInfo>>('versions', { refresh }),
  setProject: (dir: string | null) => call<{ projectDir: string | null }>('setProject', { dir }),
  pickProject: () => call<{ projectDir: string | null; cancelled?: boolean }>('pickProject'),
  sync: () => call<{ results: { id: string; label: string; ok: boolean; error?: string; version?: string; count?: number }[]; untranslated: Record<string, number> }>('sync'),
  clearCache: () => call<{ ok: boolean }>('clearCache'),
  reveal: (id: string) => call<{ ok: boolean }>('reveal', { id }),
  openExternal: (url: string) => call<{ ok: boolean }>('openExternal', { url }),
};
