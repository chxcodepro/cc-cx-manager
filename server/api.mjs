// 管理器的全部后台能力（与界面无关）。桌面端通过 IPC 调用，开发模式下由 HTTP 包装调用。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { PLATFORM, isWSL, resolveTargets, pathInfo, appDataDir, claudeConfigDir, codexHome, expandHome } from './lib/paths.mjs';
import { loadTarget, computeNext, saveTarget, listBackups, readBackup, restoreBackup, readText } from './lib/store.mjs';
import { diffHunks } from './lib/diff.mjs';
import { getCatalog, CATALOGS, clearCache } from './lib/catalog.mjs';
import { getVersions } from './lib/versions.mjs';
import { syncAll } from './lib/sync.mjs';

export class ApiError extends Error {
  constructor(status, message, code = null) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const PREFS = () => path.join(appDataDir(), 'prefs.json');

function loadPrefs() {
  try {
    return JSON.parse(fs.readFileSync(PREFS(), 'utf8'));
  } catch {
    return {};
  }
}

function savePrefs(p) {
  fs.mkdirSync(appDataDir(), { recursive: true });
  fs.writeFileSync(PREFS(), JSON.stringify(p, null, 2), 'utf8');
}

/**
 * @param {object} host 宿主能力（桌面端提供原生对话框等）
 *   host.reveal(path)        在文件管理器中显示
 *   host.pickDirectory()     弹出选择目录对话框，返回路径或 null
 *   host.openExternal(url)   用系统浏览器打开链接
 */
export function createApi(host = {}) {
  const prefs = loadPrefs();
  const state = { projectDir: prefs.projectDir && fs.existsSync(prefs.projectDir) ? prefs.projectDir : null };

  const targetsNow = () => resolveTargets(state.projectDir);
  const getTarget = (id) => {
    const t = targetsNow().find((x) => x.id === id);
    if (!t) throw new ApiError(404, '未知的配置文件：' + id);
    if (!t.path) throw new ApiError(400, '请先选择项目目录');
    return t;
  };
  // 不提供原始文本编辑的文件（~/.claude.json 含账号、项目记录等状态信息）不把全文发给界面，
  // 设置了 dataPick 时只发页面用得到的键（按 dataPrefix 原路径包好，界面照常取值）
  const pickData = (data, prefix = [], keys) => {
    let src = data;
    for (const k of prefix) src = src && typeof src === 'object' ? src[k] : undefined;
    const picked = {};
    if (src && typeof src === 'object') for (const k of keys) if (Object.hasOwn(src, k)) picked[k] = src[k];
    return prefix.reduceRight((acc, k) => ({ [k]: acc }), picked);
  };
  const fileState = (t) => {
    const s = { ...t, ...pathInfo(t.path), ...loadTarget(t) };
    if (!t.rawDisabled) return s;
    return { ...s, text: '', data: t.dataPick ? pickData(s.data, t.dataPrefix, t.dataPick) : s.data };
  };

  function setProjectDir(dir) {
    let d = dir ? String(dir).trim() : null;
    if (d) {
      d = path.resolve(expandHome(d));
      if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) throw new ApiError(400, '目录不存在：' + d);
    }
    state.projectDir = d;
    const p = loadPrefs();
    p.projectDir = d;
    if (d) p.recentProjects = [d, ...(p.recentProjects || []).filter((x) => x !== d)].slice(0, 10);
    savePrefs(p);
    return { projectDir: d };
  }

  return {
    async state() {
      const targets = targetsNow().map((t) => ({ ...t, ...pathInfo(t.path) }));
      const catalogs = {};
      for (const name of Object.keys(CATALOGS)) {
        const c = getCatalog(name);
        catalogs[name] = { stats: c.stats, meta: c.meta, overlayErrors: c.overlayErrors.length };
      }
      return {
        platform: PLATFORM,
        wsl: isWSL(),
        node: process.versions.electron ? `Electron ${process.versions.electron}` : process.version,
        home: os.homedir(),
        appData: appDataDir(),
        claudeDir: claudeConfigDir(),
        codexHome: codexHome(),
        projectDir: state.projectDir,
        recentProjects: loadPrefs().recentProjects || [],
        targets,
        catalogs,
        desktop: !!process.versions.electron,
      };
    },
    async catalog({ name }) {
      return getCatalog(name);
    },
    async file({ id }) {
      return fileState(getTarget(id));
    },
    async preview(body) {
      const t = getTarget(body.id);
      const { before, after, existed } = computeNext(t, body);
      return { existed, before, after, changed: before !== after, diff: diffHunks(before, after) };
    },
    async save(body) {
      const t = getTarget(body.id);
      const res = saveTarget(t, body);
      return { ...res, file: fileState(t) };
    },
    async backups({ id }) {
      return listBackups(getTarget(id));
    },
    async backup({ id, name }) {
      const t = getTarget(id);
      const text = readBackup(t, name);
      const cur = readText(t.path) ?? '';
      return { text, diff: diffHunks(cur, text) };
    },
    async restore({ id, name }) {
      const t = getTarget(id);
      const res = restoreBackup(t, name);
      return { ...res, file: fileState(t) };
    },
    async versions({ refresh } = {}) {
      return getVersions({ refresh: !!refresh });
    },
    async setProject({ dir }) {
      return setProjectDir(dir);
    },
    async pickProject() {
      if (!host.pickDirectory) throw new ApiError(501, '当前环境不支持目录选择对话框');
      const dir = await host.pickDirectory(state.projectDir);
      if (!dir) return { projectDir: state.projectDir, cancelled: true };
      return setProjectDir(dir);
    },
    async sync() {
      return syncAll();
    },
    async clearCache() {
      clearCache();
      return { ok: true };
    },
    async reveal({ id }) {
      const t = getTarget(id);
      const p = fs.existsSync(t.path) ? t.path : path.dirname(t.path);
      if (host.reveal) await host.reveal(p);
      return { ok: true };
    },
    async openExternal({ url }) {
      if (!/^https:\/\//.test(String(url))) throw new ApiError(400, '只允许打开 https 链接');
      if (host.openExternal) await host.openExternal(url);
      return { ok: true };
    },
  };
}

/** 统一错误格式，供 IPC / HTTP 返回 */
export function describeError(e) {
  let message = e?.message || String(e);
  let status = e?.status || 500;
  const code = e?.code || null;
  if (code === 'CONFLICT') status = 409;
  if (code === 'EACCES' || code === 'EPERM') {
    status = 403;
    message = `没有写入权限（${code}）：${e.path || ''}。系统级文件需要以管理员 / root 身份运行管理器。`;
  }
  return { status, message, code };
}

export const API_METHODS = ['state', 'catalog', 'file', 'preview', 'save', 'backups', 'backup', 'restore', 'versions', 'setProject', 'pickProject', 'sync', 'clearCache', 'reveal', 'openExternal'];
