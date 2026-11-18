import { useEffect, useMemo, useState } from 'react';
import type { DiffResult, Item, Platform, VersionInfo } from './types';
import { api } from './api';
import { deepEqual, envEncode, envTruthy, formatValue, recIsDefault, recommendedFor } from './model';

export function Modal({ title, onClose, children, wide, footer }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean; footer?: React.ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-mask" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <div className="modal-title">{title}</div>
          <button className="btn-icon" onClick={onClose} aria-label="关闭">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function DiffView({ diff, empty = '没有差异' }: { diff: DiffResult; empty?: string }) {
  if (!diff.hunks.length) return <div className="diff-empty">{empty}</div>;
  return (
    <div className="diff">
      {diff.hunks.map((h, i) => (
        <div className="diff-hunk" key={i}>
          {h.map((o, j) => (
            <div key={j} className={`diff-line ${o.t === '+' ? 'add' : o.t === '-' ? 'del' : ''}`}>
              <span className="ln">{o.t === '+' ? '' : o.a}</span>
              <span className="ln">{o.t === '-' ? '' : o.b}</span>
              <span className="sign">{o.t}</span>
              <span className="code">{o.s || ' '}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export function SaveModal({ path, diff, existed, onClose, onConfirm, busy, sensitiveMask }: {
  path: string; diff: DiffResult; existed: boolean; onClose: () => void; onConfirm: () => void; busy: boolean; sensitiveMask?: boolean;
}) {
  return (
    <Modal
      wide
      title={<>保存到 <code>{path}</code></>}
      onClose={onClose}
      footer={
        <>
          <span className="foot-note">{existed ? '保存前会自动备份当前文件，可在「备份」中恢复。' : '文件不存在，将新建。'}</span>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={busy} onClick={onConfirm}>{busy ? '保存中…' : `确认保存（+${diff.added} −${diff.removed}）`}</button>
        </>
      }
    >
      {sensitiveMask && <div className="item-note">差异中可能包含密钥，请注意屏幕共享。</div>}
      <DiffView diff={diff} />
    </Modal>
  );
}

export function RawModal({ title, path, initial, format, readOnly, onClose, onPreview, onSave }: {
  title: string; path: string; initial: string; format: string; readOnly?: boolean;
  onClose: () => void; onPreview: (text: string) => Promise<DiffResult>; onSave: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState(initial);
  const [err, setErr] = useState('');
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [busy, setBusy] = useState(false);
  const lines = text.split('\n').length;
  return (
    <Modal
      wide
      title={<>{title} <code>{path}</code></>}
      onClose={onClose}
      footer={
        <>
          <span className="foot-note">{format.toUpperCase()} · {lines} 行 · 保存前会校验格式并备份</span>
          <button className="btn" onClick={onClose}>关闭</button>
          {!readOnly && (
            <>
              <button className="btn" disabled={busy} onClick={async () => {
                setErr('');
                try { setDiff(await onPreview(text)); } catch (e) { setErr((e as Error).message); }
              }}>查看差异</button>
              <button className="btn primary" disabled={busy || text === initial} onClick={async () => {
                setErr('');
                setBusy(true);
                try { await onSave(text); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
              }}>保存</button>
            </>
          )}
        </>
      }
    >
      {err && <div className="alert error">{err}</div>}
      {diff ? (
        <div>
          <div className="row-between"><b>与当前文件的差异</b><button className="btn-link" onClick={() => setDiff(null)}>返回编辑</button></div>
          <DiffView diff={diff} />
        </div>
      ) : (
        <textarea className="raw-editor" value={text} spellCheck={false} readOnly={readOnly} onChange={(e) => setText(e.target.value)} />
      )}
    </Modal>
  );
}

export function BackupsModal({ targetId, path, onClose, onRestored }: { targetId: string; path: string; onClose: () => void; onRestored: () => void }) {
  const [list, setList] = useState<{ name: string; size: number; time: number; reason: string }[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api.backups(targetId).then(setList).catch((e) => setErr(e.message));
  }, [targetId]);
  useEffect(() => {
    if (!sel) return;
    setDiff(null);
    api.backup(targetId, sel).then((r) => setDiff(r.diff)).catch((e) => setErr(e.message));
  }, [sel, targetId]);
  const reasonName: Record<string, string> = { save: '保存前', 'before-restore': '恢复前', raw: '原始编辑前' };
  return (
    <Modal wide title={<>备份 · <code>{path}</code></>} onClose={onClose}>
      {err && <div className="alert error">{err}</div>}
      {!list ? <div className="muted">加载中…</div> : !list.length ? <div className="muted">还没有备份。每次通过管理器保存前都会自动备份。</div> : (
        <div className="backups">
          <ul className="backup-list">
            {list.map((b) => (
              <li key={b.name} className={sel === b.name ? 'active' : ''} onClick={() => setSel(b.name)}>
                <div>{new Date(b.time).toLocaleString('zh-CN')}</div>
                <div className="muted small">{reasonName[b.reason] || b.reason} · {(b.size / 1024).toFixed(1)} KB</div>
              </li>
            ))}
          </ul>
          <div className="backup-view">
            {!sel ? <div className="muted">选择左侧的备份查看与当前文件的差异</div> : !diff ? <div className="muted">加载中…</div> : (
              <>
                <div className="row-between">
                  <span>恢复后将产生的变化（当前 → 备份）</span>
                  <button className="btn primary" onClick={async () => {
                    if (!confirm('用此备份覆盖当前文件？当前内容会先自动备份。')) return;
                    try { await api.restore(targetId, sel); onRestored(); } catch (e) { setErr((e as Error).message); }
                  }}>恢复此备份</button>
                </div>
                <DiffView diff={diff} empty="与当前文件相同" />
              </>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export interface RecRow { item: Item; path: string[]; current: unknown; next: unknown }

export function RecommendModal({ items, platform, env, getValue, scope, onClose, onApply }: {
  items: Item[]; platform: Platform; env: boolean; scope?: string;
  getValue: (item: Item) => unknown; onClose: () => void; onApply: (rows: { item: Item; value: unknown }[]) => void;
}) {
  const rows = useMemo(() => {
    const out: { item: Item; current: unknown; next: unknown; userSet: boolean }[] = [];
    for (const item of items) {
      const rec = recommendedFor(item, platform);
      if (rec === undefined || item.sensitive || item.deprecated) continue;
      if (item.platforms?.length && !item.platforms.includes(platform)) continue;
      if (scope && item.scopes?.length && !item.scopes.includes(scope)) continue;
      const cur = getValue(item);
      if (recIsDefault(item, cur, rec)) continue;
      const next = env ? envEncode(item, rec) : rec;
      const same = deepEqual(cur, next) || (env && item.type === 'boolean' && typeof rec === 'boolean' && cur !== undefined && envTruthy(cur, item) === rec);
      if (same) continue;
      out.push({ item, current: cur, next, userSet: cur !== undefined });
    }
    return out;
  }, [items, platform, env, getValue, scope]);
  const [checked, setChecked] = useState<Set<string>>(() => new Set(rows.filter((r) => !r.userSet).map((r) => r.item.key)));
  const toggle = (k: string) => {
    const s = new Set(checked);
    s.has(k) ? s.delete(k) : s.add(k);
    setChecked(s);
  };
  return (
    <Modal
      wide
      title="应用推荐配置"
      onClose={onClose}
      footer={
        <>
          <span className="foot-note">只会修改草稿，保存前还能查看差异。默认不勾选你已经设置过的项。</span>
          <button className="btn" onClick={onClose}>取消</button>
          <button className="btn primary" disabled={!checked.size} onClick={() => onApply(rows.filter((r) => checked.has(r.item.key)).map((r) => ({ item: r.item, value: r.next })))}>
            应用所选（{checked.size}）
          </button>
        </>
      }
    >
      {!rows.length ? <div className="muted">当前配置已经符合全部推荐值。</div> : (
        <>
          <div className="row-between rec-tools">
            <span>{rows.length} 项与推荐值不同</span>
            <span>
              <button className="btn-link" onClick={() => setChecked(new Set(rows.map((r) => r.item.key)))}>全选</button>
              <button className="btn-link" onClick={() => setChecked(new Set())}>全不选</button>
            </span>
          </div>
          <table className="rec-table">
            <thead><tr><th></th><th>参数</th><th>当前</th><th>推荐</th><th>理由</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item.key} className={checked.has(r.item.key) ? 'on' : ''} onClick={() => toggle(r.item.key)}>
                  <td><input type="checkbox" checked={checked.has(r.item.key)} readOnly /></td>
                  <td><div>{r.item.title}</div><code className="small">{r.item.key}</code></td>
                  <td className={r.userSet ? 'user-set' : 'muted'}>{formatValue(r.current)}</td>
                  <td><code>{formatValue(r.next)}</code></td>
                  <td className="small">{r.item.recommendedReason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Modal>
  );
}

export function VersionsModal({ versions, onClose, onRefresh, refreshing, onSync, onClearCache, syncing, syncResult, catalogsMeta }: {
  versions: Record<'claude' | 'codex', VersionInfo> | null;
  onClose: () => void; onRefresh: () => void; refreshing: boolean;
  onSync: () => void; onClearCache?: () => void; syncing: boolean;
  syncResult: { results: { id: string; label: string; ok: boolean; error?: string; version?: string; count?: number }[]; untranslated: Record<string, number> } | null;
  catalogsMeta: Record<string, { stats: { total: number; untranslated: number }; meta: { name: string; version?: string; from?: string }[] }>;
}) {
  const [copied, setCopied] = useState('');
  const copy = (s: string) => {
    navigator.clipboard?.writeText(s);
    setCopied(s);
    setTimeout(() => setCopied(''), 1500);
  };
  const catName: Record<string, string> = { 'claude-settings': 'Claude settings.json', 'claude-env': 'Claude 环境变量', 'claude-mcp': 'Claude MCP 服务器', 'codex-config': 'Codex config.toml（含 features）', 'codex-env': 'Codex .env' };
  return (
    <Modal wide title="版本与参数目录" onClose={onClose}>
      <div className="ver-grid">
        {(['claude', 'codex'] as const).map((p) => {
          const v = versions?.[p];
          return (
            <div className="ver-card" key={p}>
              <div className="ver-name">{v?.name || (p === 'claude' ? 'Claude Code' : 'Codex CLI')}</div>
              {!v ? <div className="muted">检测中…</div> : (
                <>
                  <div className="ver-line">已安装：<b>{v.installed || '未检测到'}</b></div>
                  <div className="ver-line">最新版：<b>{v.latest || '查询失败'}</b>{v.registry && <span className="muted small">（{v.registry.replace('https://', '')}）</span>}</div>
                  <div className={`ver-status ${v.outdated ? 'warn' : v.installed ? 'ok' : ''}`}>
                    {!v.installed ? '未安装或不在 PATH 中' : v.outdated ? '有新版本可用' : v.latest ? '已是最新版' : '无法确认是否最新'}
                  </div>
                  {v.bin && <div className="muted small path">{v.bin}</div>}
                  <div className="ver-cmds">
                    {v.updateCommands.map((c) => (
                      <div className="cmd" key={c.cmd}>
                        <span className="cmd-label">{c.label}</span>
                        <code>{c.cmd}</code>
                        <button className="btn-small" onClick={() => copy(c.cmd)}>{copied === c.cmd ? '已复制' : '复制'}</button>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="row-between" style={{ marginTop: 12 }}>
        <span className="muted small">在终端里运行上面的命令更新；更新完成后点「同步最新参数」，让管理器识别新版本的参数。</span>
        <button className="btn" disabled={refreshing} onClick={onRefresh}>{refreshing ? '检查中…' : '重新检查版本'}</button>
      </div>
      <h3 className="sub-title">参数目录</h3>
      <table className="cat-table">
        <thead><tr><th>目录</th><th>对应版本</th><th>来源</th><th>参数数</th><th>未翻译</th></tr></thead>
        <tbody>
          {Object.entries(catalogsMeta).map(([k, c]) => (
            <tr key={k}>
              <td>{catName[k] || k}</td>
              <td>{c.meta.map((m) => m.version).filter(Boolean).join(' / ')}</td>
              <td className="small">{c.meta.map((m) => (m.from === 'cache' ? '本机同步' : '内置')).join(' / ')}</td>
              <td>{c.stats.total}</td>
              <td>{c.stats.untranslated || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-between" style={{ marginTop: 12 }}>
        <span className="muted small">「同步最新参数」会读取本机 Claude Code 程序内置的 settings 定义、本机 Codex 的功能开关列表，并下载与已安装 Codex 版本对应的官方 schema 和最新环境变量文档。新增参数会以「新参数」标注并显示官方英文说明。</span>
        <div className="btn-row">
          {onClearCache && Object.values(catalogsMeta).some((c) => c.meta.some((m) => m.from === 'cache')) && (
            <button className="btn" disabled={syncing} onClick={onClearCache} title="删除本机同步生成的参数目录，改回程序自带的版本">恢复内置目录</button>
          )}
          <button className="btn primary" disabled={syncing} onClick={onSync}>{syncing ? '同步中…' : '同步最新参数'}</button>
        </div>
      </div>
      {syncResult && (
        <ul className="sync-result">
          {syncResult.results.map((r) => (
            <li key={r.id} className={r.ok ? 'ok' : 'fail'}>
              {r.ok ? '✓' : '✕'} {r.label}{r.ok ? `：${r.count} 项（${r.version}）` : `：${r.error}`}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function ProjectModal({ current, recent, onClose, onSet, onPick }: { current: string | null; recent: string[]; onClose: () => void; onSet: (dir: string | null) => Promise<void>; onPick?: () => Promise<string | null> }) {
  const [dir, setDir] = useState(current || '');
  const [err, setErr] = useState('');
  const submit = async (d: string | null) => {
    setErr('');
    try { await onSet(d); onClose(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <Modal title="选择项目目录" onClose={onClose} footer={
      <>
        {current && <button className="btn" onClick={() => submit(null)}>清除项目</button>}
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" disabled={!dir.trim()} onClick={() => submit(dir.trim())}>确定</button>
      </>
    }>
      <p className="muted small">项目目录用于编辑项目级配置：<code>.claude/settings.json</code>、<code>.claude/settings.local.json</code>、<code>.codex/config.toml</code>。粘贴项目的完整路径（Windows 如 <code>D:\work\app</code>，macOS / Linux 如 <code>~/work/app</code>）。</p>
      <div className="map-row">
        <input className="input-full" value={dir} autoFocus spellCheck={false} placeholder="项目完整路径" onChange={(e) => setDir(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && dir.trim()) submit(dir.trim()); }} />
        {onPick && (
          <button className="btn" onClick={async () => {
            setErr('');
            try {
              const d = await onPick();
              if (d) { setDir(d); onClose(); }
            } catch (e) { setErr((e as Error).message); }
          }}>浏览…</button>
        )}
      </div>
      {err && <div className="alert error">{err}</div>}
      {recent.length > 0 && (
        <>
          <div className="sub-title">最近使用</div>
          <ul className="recent-list">
            {recent.map((r) => <li key={r} onClick={() => submit(r)}><code>{r}</code></li>)}
          </ul>
        </>
      )}
    </Modal>
  );
}
