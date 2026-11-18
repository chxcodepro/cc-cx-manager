// 配置文件读写：哈希冲突检测、写前备份、原子写入、备份恢复
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { appDataDir, PLATFORM } from './paths.mjs';
import { FORMATS, applyOps, toTransit } from './formats.mjs';

const MAX_BACKUPS = 50;

export function hashText(text) {
  return crypto.createHash('sha256').update(text ?? '', 'utf8').digest('hex').slice(0, 16);
}

export function readText(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

/** 读取并解析一个 target */
export function loadTarget(target) {
  if (!target.path) return { exists: false, text: '', data: {}, hash: hashText('') };
  const text = readText(target.path);
  if (text === null) return { exists: false, text: '', data: {}, hash: hashText('') };
  const res = { exists: true, text, hash: hashText(text) };
  try {
    res.data = toTransit(FORMATS[target.format].parse(text));
  } catch (e) {
    res.data = null;
    res.parseError = e.message;
  }
  return res;
}

export class ConflictError extends Error {
  constructor() {
    super('文件在你编辑期间已被其他程序修改，请重新加载后再保存');
    this.code = 'CONFLICT';
  }
}

/**
 * 计算保存后的文本（不落盘）。
 * body: { ops } 或 { text }；baseHash 用于冲突检测
 */
export function computeNext(target, body) {
  const cur = readText(target.path);
  const curText = cur ?? '';
  const rawText = typeof body.text === 'string';
  if (rawText && target.rawDisabled) throw new Error('这个文件由程序频繁改写，不支持原始文本编辑');
  // live 文件（如 ~/.claude.json）会被 Claude Code 随时改写：可视化修改按路径合并进最新内容，不做整文件冲突检测
  const merge = target.live && !rawText;
  if (!merge && body.baseHash && body.baseHash !== hashText(curText)) throw new ConflictError();
  const fmt = FORMATS[target.format];
  let nextText;
  if (typeof body.text === 'string') {
    nextText = body.text;
    fmt.parse(nextText); // 校验，失败直接抛出
  } else {
    let data;
    try {
      data = fmt.parse(curText);
    } catch (e) {
      throw new Error('当前文件无法解析，只能用「原始文本」模式修复：' + e.message);
    }
    applyOps(data, body.ops || []);
    nextText = fmt.serialize(data, cur);
    fmt.parse(nextText); // 再次校验输出合法
  }
  return { before: curText, after: nextText, existed: cur !== null };
}

function backupDirFor(target) {
  return path.join(appDataDir(), 'backups', target.id);
}

function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-${p(d.getMilliseconds(), 3)}`;
}

export function backupNow(target, text, reason = 'save') {
  if (text === null || text === undefined) return null;
  const dir = backupDirFor(target);
  fs.mkdirSync(dir, { recursive: true });
  const name = `${stamp()}__${reason}__${path.basename(target.path)}`;
  const file = path.join(dir, name);
  fs.writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
  // 记录原路径，方便恢复时核对
  fs.writeFileSync(path.join(dir, 'source.txt'), target.path, 'utf8');
  pruneBackups(dir);
  return file;
}

function pruneBackups(dir) {
  const files = fs.readdirSync(dir).filter((f) => f.includes('__')).sort();
  while (files.length > MAX_BACKUPS) {
    const f = files.shift();
    try { fs.unlinkSync(path.join(dir, f)); } catch {}
  }
}

export function listBackups(target) {
  const dir = backupDirFor(target);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.includes('__'))
    .sort()
    .reverse()
    .map((name) => {
      const st = fs.statSync(path.join(dir, name));
      const [ts, reason] = name.split('__');
      return { name, size: st.size, time: st.mtimeMs, reason, stamp: ts };
    });
}

export function readBackup(target, name) {
  if (!/^[\w.-]+__[\w-]+__[\w.-]+$/.test(name)) throw new Error('非法的备份名');
  return fs.readFileSync(path.join(backupDirFor(target), name), 'utf8');
}

/** 原子写入：先写同目录临时文件再 rename；保留原文件权限 */
export function atomicWrite(file, text, { secret = false } = {}) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  let mode;
  try { mode = fs.statSync(file).mode & 0o777; } catch { mode = secret ? 0o600 : 0o644; }
  const tmp = path.join(dir, `.${path.basename(file)}.ccm-${process.pid}-${Date.now()}.tmp`);
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode });
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    // Windows 上目标被占用时 rename 可能失败，退回直接覆盖写
    try { fs.unlinkSync(tmp); } catch {}
    if (PLATFORM === 'windows' && (e.code === 'EPERM' || e.code === 'EBUSY' || e.code === 'EACCES')) {
      fs.writeFileSync(file, text, 'utf8');
    } else throw e;
  }
  if (PLATFORM !== 'windows') {
    try { fs.chmodSync(file, mode); } catch {}
  }
}

/** 保存：冲突检测 → 备份 → 原子写入 */
export function saveTarget(target, body) {
  const { before, after, existed } = computeNext(target, body);
  if (existed && before === after) return { changed: false, hash: hashText(after) };
  const backup = existed ? backupNow(target, before, body.reason || 'save') : null;
  atomicWrite(target.path, after, { secret: target.format === 'dotenv' });
  return { changed: true, hash: hashText(after), backup };
}

export function restoreBackup(target, name) {
  const text = readBackup(target, name);
  FORMATS[target.format].parse(text); // 确认备份本身可解析
  const cur = readText(target.path);
  const backup = cur !== null ? backupNow(target, cur, 'before-restore') : null;
  atomicWrite(target.path, text, { secret: target.format === 'dotenv' });
  return { hash: hashText(text), backup };
}
