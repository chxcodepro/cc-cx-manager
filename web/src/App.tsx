import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, isDesktop } from './api';
import type { AppState, Catalog, DiffResult, FileState, Item, Op, VersionInfo } from './types';
import { ItemCard, ItemHelp, RecordEditor, type ItemCtx } from './ItemView';
import { HelpTip } from './HelpTip';
import { BackupsModal, ProjectModal, RawModal, RecommendModal, SaveModal, VersionsModal } from './Modals';
import {
  changedPaths, collectEnvRefs, deepEqual, diffOps, getIn, isPlainObject, isTierHidden, keyToPath, pathChanged, recIsDefault,
  recordFields, recommendedFor, renameIn, searchText, setIn, unsetIn, envTruthy, envEncode, type Obj,
} from './model';

interface PageDef {
  id: string;
  product: 'claude' | 'codex';
  label: string;
  hint: string;
  catalog: string;
  env: boolean;
  prefix: string[];
  filter?: (i: Item) => boolean;
  fixedTarget?: string;
  targets: string[];
  excludeUnknown?: string[];
  /** 不列出「未收录的参数」（文件里还有很多与本页无关的内容） */
  noUnknown?: boolean;
}

const PAGES: PageDef[] = [
  { id: 'claude-settings', product: 'claude', label: '设置', hint: 'settings.json', catalog: 'claude-settings', env: false, prefix: [], targets: ['claude-user', 'claude-project', 'claude-local', 'claude-managed'], excludeUnknown: ['env', '$schema'] },
  { id: 'claude-env', product: 'claude', label: '环境变量', hint: 'settings.json → env', catalog: 'claude-env', env: true, prefix: ['env'], targets: ['claude-user', 'claude-project', 'claude-local', 'claude-managed'] },
  { id: 'claude-mcp', product: 'claude', label: 'MCP 服务器', hint: '~/.claude.json · .mcp.json', catalog: 'claude-mcp', env: false, prefix: [], targets: ['claude-mcp-user', 'claude-mcp-project', 'claude-mcp-local'], noUnknown: true },
  { id: 'codex-config', product: 'codex', label: '配置', hint: 'config.toml', catalog: 'codex-config', env: false, prefix: [], filter: (i) => !i.key.startsWith('features.') && i.key !== 'features', targets: ['codex-user', 'codex-project', 'codex-requirements'], excludeUnknown: ['features'] },
  { id: 'codex-features', product: 'codex', label: '功能开关', hint: 'config.toml → [features]', catalog: 'codex-config', env: false, prefix: [], filter: (i) => i.key.startsWith('features.'), targets: ['codex-user', 'codex-project'] },
  { id: 'codex-env', product: 'codex', label: '环境变量', hint: '.env', catalog: 'codex-env', env: true, prefix: [], fixedTarget: 'codex-env', targets: ['codex-env'] },
];

// 页面级补充说明（显示在页头的「?」中）
const PAGE_NOTE: Record<string, string> = {
  'claude-env': '这些变量写入 settings 文件的 env 对象，Claude Code 启动时生效',
  'claude-mcp': '修改后重新启动 Claude Code 生效；Claude Code 运行时也会改写 ~/.claude.json，保存时只合并你改动的部分',
  'codex-features': '写在 config.toml 的 [features] 表中，也可以启动时用 --enable / --disable 临时切换',
  'codex-env': '只读取 CODEX_HOME/.env，变量会覆盖同名的系统环境变量；CODEX_ 开头的变量写在这里无效',
};

type Chip = 'all' | 'set' | 'rec' | 'changed' | 'new';

/** 「显示 ▾」菜单：把默认隐藏的参数类别收在一个下拉里，工具栏更简洁 */
function ShowMenu({ options }: { options: { label: string; checked: boolean; onChange: (v: boolean) => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const n = options.filter((o) => o.checked).length;
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="show-menu" ref={ref}>
      <button className={`chip ${n ? 'has' : ''}`} onClick={() => setOpen(!open)} title="显示默认隐藏的参数">显示{n ? ` ${n}` : ''} ▾</button>
      {open && (
        <div className="show-pop">
          {options.map((o) => (
            <label key={o.label}><input type="checkbox" checked={o.checked} onChange={(e) => o.onChange(e.target.checked)} />{o.label}</label>
          ))}
        </div>
      )}
    </div>
  );
}

const UNKNOWN_CAT = '__unknown';

function useLocal<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem('ccm.' + key);
      return s ? (JSON.parse(s) as T) : init;
    } catch {
      return init;
    }
  });
  const set = useCallback((nv: T) => {
    setV(nv);
    try { localStorage.setItem('ccm.' + key, JSON.stringify(nv)); } catch {}
  }, [key]);
  return [v, set];
}

export default function App() {
  const [app, setApp] = useState<AppState | null>(null);
  const [fatal, setFatal] = useState('');
  const [pageId, setPageId] = useLocal('page', 'claude-settings');
  const [claudeTarget, setClaudeTarget] = useLocal('claudeTarget', 'claude-user');
  const [codexTarget, setCodexTarget] = useLocal('codexTarget', 'codex-user');
  const [mcpTarget, setMcpTarget] = useLocal('mcpTarget', 'claude-mcp-user');
  const [theme, setTheme] = useLocal<'auto' | 'light' | 'dark'>('theme', 'auto');
  const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({});
  const [file, setFile] = useState<FileState | null>(null);
  const [draft, setDraft] = useState<Obj>({});
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [chip, setChip] = useState<Chip>('all');
  const [cat, setCat] = useState<string>('');
  const [showDeprecated, setShowDeprecated] = useLocal('showDeprecated', false);
  const [showEnterprise, setShowEnterprise] = useLocal('showEnterprise', false);
  const [showOtherOS, setShowOtherOS] = useLocal('showOtherOS', false);
  const [showDev, setShowDev] = useLocal('showDev', false);
  const [versions, setVersions] = useState<Record<'claude' | 'codex', VersionInfo> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<any>(null);
  const [modal, setModal] = useState<null | 'save' | 'raw' | 'backups' | 'rec' | 'versions' | 'project'>(null);
  const [saveInfo, setSaveInfo] = useState<{ diff: DiffResult; existed: boolean; ops: Op[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [newEnv, setNewEnv] = useState({ k: '', v: '' });
  const listRef = useRef<HTMLDivElement>(null);

  const page = PAGES.find((p) => p.id === pageId) || PAGES[0];
  const targetId = page.fixedTarget || (page.id === 'claude-mcp' ? mcpTarget : page.product === 'claude' ? claudeTarget : codexTarget);
  const effectiveTargetId = page.targets.includes(targetId) ? targetId : page.targets[0];
  const target = app?.targets.find((t) => t.id === effectiveTargetId);
  const catalog = catalogs[page.catalog];
  const rawOnly = effectiveTargetId === 'codex-requirements';
  // 参数在文件中的位置：页面前缀（如 env）+ 目标前缀（如 ~/.claude.json 的 projects.<路径>）
  const basePrefix = useMemo(() => [...page.prefix, ...(target?.dataPrefix || [])], [page, target]);
  const readOnly = !!file && (file.data === null || (!file.writable && !!file.path));

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', theme);
  }, [theme]);

  const notify = (kind: 'ok' | 'error', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), kind === 'error' ? 7000 : 3000);
  };

  const loadState = useCallback(async () => {
    try {
      setApp(await api.state());
    } catch (e) {
      setFatal((e as Error).message);
    }
  }, []);

  useEffect(() => {
    loadState();
    api.versions().then(setVersions).catch(() => {});
  }, [loadState]);

  // 加载参数目录
  useEffect(() => {
    if (catalogs[page.catalog]) return;
    api.catalog(page.catalog).then((c) => setCatalogs((m) => ({ ...m, [page.catalog]: c }))).catch((e) => notify('error', e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.catalog]);

  // 加载配置文件
  const loadFile = useCallback(async () => {
    if (!target || !target.path) { setFile(null); setDraft({}); return; }
    setLoading(true);
    try {
      const f = await api.file(target.id);
      setFile(f);
      setDraft((f.data as Obj) || {});
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [target?.id, target?.path]);

  useEffect(() => { loadFile(); }, [loadFile]);

  const original = (file?.data as Obj) || {};
  const ops = useMemo(() => (file && file.data ? diffOps(original, draft) : []), [file, draft]);
  const changed = useMemo(() => changedPaths(original, draft), [file, draft]);
  const dirty = ops.length > 0;

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const guard = (fn: () => void) => {
    if (dirty && !confirm('有未保存的修改，确定放弃吗？')) return;
    fn();
  };

  const ctx: ItemCtx = { platform: app?.platform || 'windows', env: page.env, scope: target?.scope, readOnly };

  // Codex .env 页：列出 config.toml 中 env_key 等字段引用的变量（用户级 + 项目级）
  const [envRefs, setEnvRefs] = useState<Item[]>([]);
  useEffect(() => {
    if (page.id !== 'codex-env' || !app) { setEnvRefs([]); return; }
    let alive = true;
    (async () => {
      const found = new Map<string, Item>();
      for (const id of ['codex-user', 'codex-project']) {
        const t = app.targets.find((x) => x.id === id);
        if (!t?.path || !t.exists) continue;
        try {
          const f = await api.file(id);
          if (isPlainObject(f.data)) collectEnvRefs(f.data, t.label, found);
        } catch {
          // 读取失败（如格式错误）时忽略，不影响 .env 编辑
        }
      }
      if (alive) setEnvRefs([...found.values()]);
    })();
    return () => { alive = false; };
  }, [page.id, app]);

  // ---------- 列表计算 ----------
  const knownItems = useMemo<Item[]>(() => {
    if (!catalog) return [];
    if (page.id !== 'codex-env' || !envRefs.length) return catalog.items;
    const keys = new Set(catalog.items.map((i) => i.key));
    return [...catalog.items, ...envRefs.filter((r) => !keys.has(r.key))];
  }, [catalog, page, envRefs]);

  const pageItems = useMemo(
    () => knownItems.filter((i) => !i.key.includes('*') && (!page.filter || page.filter(i))),
    [knownItems, page],
  );

  const hasTierItems = useMemo(() => pageItems.some(isTierHidden), [pageItems]);

  const valueOf = useCallback((item: Item) => getIn(draft, keyToPath(item.key, basePrefix)), [draft, basePrefix]);

  const unknownItems = useMemo<Item[]>(() => {
    if (!catalog || !file?.data || page.noUnknown) return [];
    const keys = new Set(knownItems.map((i) => i.key));
    const prefixes = new Set<string>();
    for (const k of keys) {
      const parts = k.split('.');
      for (let i = 1; i < parts.length; i++) prefixes.add(parts.slice(0, i).join('.'));
    }
    const root = basePrefix.length ? getIn(draft, basePrefix) : draft;
    if (!isPlainObject(root)) return [];
    const out: Item[] = [];
    const walk = (obj: Obj, path: string[]) => {
      for (const k of Object.keys(obj)) {
        const p = [...path, k];
        const full = p.join('.');
        if (!path.length && page.excludeUnknown?.includes(k)) continue;
        if (page.id === 'codex-features' && !full.startsWith('features')) continue;
        const item = knownItems.find((i) => i.key === full);
        if (item) {
          if (item.type === 'group' && isPlainObject(obj[k])) walk(obj[k] as Obj, p);
          continue;
        }
        if (prefixes.has(full) && isPlainObject(obj[k])) { walk(obj[k] as Obj, p); continue; }
        out.push({
          key: full,
          title: k,
          category: UNKNOWN_CAT,
          type: page.env ? 'string' : 'json',
          description: page.env ? '自定义环境变量（不在参数目录中）。' : '参数目录中没有收录此项：可能是旧版本遗留、拼写错误，或由其他工具写入。可以直接编辑或清除。',
        });
      }
    };
    walk(root, []);
    return out;
  }, [catalog, knownItems, file, draft, page, basePrefix]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const scope = target?.scope;
    const platform = app?.platform || 'windows';
    const res: Item[] = [];
    for (const item of [...pageItems, ...unknownItems]) {
      const v = valueOf(item);
      const isSet = v !== undefined;
      if (item.category !== UNKNOWN_CAT) {
        if (!isSet && item.deprecated && !showDeprecated) continue;
        if (!isSet && !showEnterprise && scope !== 'managed' && isTierHidden(item)) continue;
        if (!isSet && !showOtherOS && item.platforms?.length && !item.platforms.includes(platform)) continue;
        if (!isSet && !showDev && page.id === 'codex-features' && (item.stage === 'under development' || item.stage === 'removed')) continue;
      }
      if (q && !searchText(item).includes(q)) continue;
      if (chip === 'set' && !isSet) continue;
      if (chip === 'changed' && !pathChanged(changed, keyToPath(item.key, basePrefix))) continue;
      if (chip === 'new' && !item.untranslated) continue;
      if (chip === 'rec') {
        const rec = recommendedFor(item, platform);
        if (rec === undefined || recIsDefault(item, v, rec)) continue;
        const next = page.env ? envEncode(item, rec) : rec;
        if (deepEqual(v, next) || (page.env && item.type === 'boolean' && typeof rec === 'boolean' && v !== undefined && envTruthy(v, item) === rec)) continue;
      }
      res.push(item);
    }
    return res;
  }, [pageItems, unknownItems, search, chip, showDeprecated, showEnterprise, showOtherOS, showDev, valueOf, changed, target, app, page, basePrefix]);

  const categories = useMemo(() => {
    if (!catalog) return [];
    const counts = new Map<string, { total: number; set: number }>();
    for (const i of filtered) {
      if (i.type === 'group') continue;
      const c = counts.get(i.category) || { total: 0, set: 0 };
      c.total++;
      if (valueOf(i) !== undefined) c.set++;
      counts.set(i.category, c);
    }
    const list = catalog.categories.filter((c) => counts.has(c.id)).map((c) => ({ ...c, ...counts.get(c.id)! }));
    if (counts.has(UNKNOWN_CAT)) list.push({ id: UNKNOWN_CAT, name: page.env ? '自定义变量' : '未收录的参数', order: 99999, ...counts.get(UNKNOWN_CAT)! });
    return list;
  }, [catalog, filtered, valueOf, page]);

  const searching = search.trim() !== '' || chip !== 'all';
  const activeCat = categories.some((c) => c.id === cat) ? cat : categories[0]?.id;
  const shown = searching ? filtered : filtered.filter((i) => i.category === activeCat);
  const LIMIT = 300;

  useEffect(() => { listRef.current?.scrollTo({ top: 0 }); }, [activeCat, pageId, effectiveTargetId]);

  // ---------- 修改 ----------
  const setPath = (path: string[], v: unknown) => setDraft((d) => setIn(d, path, v));
  const unsetPath = (path: string[]) => setDraft((d) => unsetIn(d, path));
  const renamePath = (path: string[], to: string) => setDraft((d) => renameIn(d, path, to));

  const openSave = async () => {
    if (!target || !file) return;
    try {
      const r = await api.preview(target.id, { ops, baseHash: file.hash });
      setSaveInfo({ diff: r.diff, existed: r.existed, ops });
      setModal('save');
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };

  const doSave = async () => {
    if (!target || !file || !saveInfo) return;
    setBusy(true);
    try {
      const r = await api.save(target.id, { ops: saveInfo.ops, baseHash: file.hash });
      setFile(r.file);
      setDraft((r.file.data as Obj) || {});
      setModal(null);
      notify('ok', r.changed ? '已保存' + (r.backup ? '，旧文件已备份' : '') : '没有需要保存的变化');
      loadState();
    } catch (e) {
      notify('error', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // 快捷键保存：输入框里的内容失焦时才写入待保存列表，所以先让它失焦，
  // 等这次修改进入状态后，再用最新的状态打开保存窗口
  const latest = useRef({ dirty, openSave });
  useLayoutEffect(() => { latest.current = { dirty, openSave }; });
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (modal) return;
        const el = document.activeElement;
        if (el instanceof HTMLElement && el.matches('input, textarea, select')) el.blur();
        setTimeout(() => { if (latest.current.dirty) latest.current.openSave(); }, 0);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const switchPage = (id: string) => guard(() => { setPageId(id); setSearch(''); setChip('all'); setCat(''); });
  const switchTarget = (id: string) => guard(() => {
    if (page.id === 'claude-mcp') setMcpTarget(id);
    else if (page.product === 'claude') setClaudeTarget(id);
    else setCodexTarget(id);
  });

  if (fatal) {
    return (
      <div className="fatal">
        <h2>无法连接管理器服务</h2>
        <p>{fatal}</p>
        <p className="muted">请确认是从启动命令打印的地址打开的页面，或重新运行 <code>npm start</code>。</p>
      </div>
    );
  }
  if (!app) return <div className="boot">正在加载…</div>;

  const pageTargets = page.targets.map((id) => app.targets.find((t) => t.id === id)!).filter(Boolean);
  const verChip = (p: 'claude' | 'codex') => {
    const v = versions?.[p];
    if (!v) return <span className="ver-chip muted">…</span>;
    if (!v.installed) return <span className="ver-chip warn" title="未检测到">未安装</span>;
    return <span className={`ver-chip ${v.outdated ? 'warn' : 'ok'}`} title={v.outdated ? `最新 ${v.latest}` : '已是最新'}>{v.installed}{v.outdated ? ' ↑' : ''}</span>;
  };

  const renderItem = (item: Item) => {
    const path = keyToPath(item.key, basePrefix);
    const value = getIn(draft, path);
    const isChanged = pathChanged(changed, path);
    if (item.type === 'group') {
      return (
        <div className="group-head" key={item.key} id={`item-${item.key}`}>
          <span className="group-title">{item.title}</span>
          <HelpTip label={`${item.title}：说明`}><ItemHelp item={item} ctx={ctx} value={undefined} /></HelpTip>
          {item.untranslated && <span className="badge badge-new">新</span>}
        </div>
      );
    }
    if (page.id === 'claude-settings' && item.key === 'env') {
      const n = isPlainObject(value) ? Object.keys(value).length : 0;
      return (
        <ItemCard key={item.key} item={item} value={value} changed={isChanged} ctx={ctx} onSet={(v) => setPath(path, v)} onUnset={() => unsetPath(path)}>
          <button className="btn" onClick={() => switchPage('claude-env')}>编辑环境变量（{n} 个）→</button>
        </ItemCard>
      );
    }
    if (item.type === 'record' && catalog) {
      let fields: Item[] = recordFields(catalog.items, item.key).map((f) => ({ ...f, fullKey: f.key, key: f.key.slice(item.key.length + 3) }));
      if (item.fieldKeys?.length) {
        fields = item.fieldKeys.map((fk) => {
          const top = catalog.items.find((i) => i.key === fk);
          return top ? { ...top, fullKey: top.key } : { key: fk, title: fk, category: '', type: 'json' as const, description: '' };
        }).filter((f) => f.type !== 'group' && f.type !== 'record');
      }
      const n = isPlainObject(value) ? Object.keys(value).length : 0;
      return (
        <ItemCard key={item.key} item={item} value={n ? value : undefined} changed={isChanged} ctx={ctx} onSet={(v) => setPath(path, v)} onUnset={() => unsetPath(path)}>
          <RecordEditor
            reserved={[...new Set(catalog.items.filter((i) => i.key.startsWith(item.key + '.') && !i.key.startsWith(item.key + '.*')).map((i) => i.key.slice(item.key.length + 1).split('.')[0]))]}
            item={item}
            value={value}
            fields={fields}
            ctx={ctx}
            basePath={path}
            changedFn={(p) => pathChanged(changed, p)}
            onSetPath={setPath}
            onUnsetPath={unsetPath}
            onRename={renamePath}
          />
        </ItemCard>
      );
    }
    return <ItemCard key={item.key} item={item} value={value} changed={isChanged} ctx={ctx} onSet={(v) => setPath(path, v)} onUnset={() => unsetPath(path)} />;
  };

  const grouped: { cat: string; name: string; items: Item[] }[] = [];
  if (searching) {
    for (const c of categories) {
      const its = shown.filter((i) => i.category === c.id);
      if (its.length) grouped.push({ cat: c.id, name: c.name, items: its });
    }
  }

  const catInfo = categories.find((c) => c.id === activeCat);
  const catDesc = catalog?.categories.find((c) => c.id === activeCat)?.description;
  const totalSet = pageItems.filter((i) => i.type !== 'group' && valueOf(i) !== undefined).length;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <div className="logo">⚙</div>
          <div>
            <div className="brand-name">配置管理器</div>
            <div className="brand-sub">Claude Code · Codex</div>
          </div>
        </div>
        {(['claude', 'codex'] as const).map((prod) => (
          <div className="nav-group" key={prod}>
            <div className="nav-product">
              <span>{prod === 'claude' ? 'Claude Code' : 'Codex'}</span>
              {verChip(prod)}
            </div>
            {PAGES.filter((p) => p.product === prod).map((p) => (
              <button key={p.id} className={`nav-item ${p.id === page.id ? 'active' : ''}`} title={p.hint} onClick={() => switchPage(p.id)}>
                <span>{p.label}</span>
              </button>
            ))}
          </div>
        ))}
        <div className="nav-bottom">
          <button className="nav-item" onClick={() => setModal('project')} title={app.projectDir || '项目级配置需要先选择项目目录'}>
            <span>项目目录</span>
            <span className="nav-hint">{app.projectDir ? shortPath(app.projectDir) : '未选择'}</span>
          </button>
          <button className="nav-item" onClick={() => setModal('versions')} title="检查更新、同步最新参数">
            <span>版本与更新</span>
          </button>
          <div className="theme-switch" title={`${platformName(app.platform)}${app.wsl ? '（WSL）' : ''} · Node ${app.node}`}>
            {(['auto', 'light', 'dark'] as const).map((t) => (
              <button key={t} className={theme === t ? 'active' : ''} onClick={() => setTheme(t)}>{t === 'auto' ? '自动' : t === 'light' ? '浅色' : '深色'}</button>
            ))}
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="page-head">
          <div className="page-title-row">
            <h1>{page.product === 'claude' ? 'Claude Code' : 'Codex'} · {page.label}</h1>
            {pageTargets.length > 1 && (
              <div className="target-tabs" role="tablist">
                {pageTargets.map((t) => (
                  <button key={t.id} className={`target-tab ${t.id === effectiveTargetId ? 'active' : ''}`} title={t.desc} onClick={() => switchTarget(t.id)}>
                    {t.label}{t.exists ? '' : <span className="dot-missing" title="文件不存在">○</span>}
                  </button>
                ))}
              </div>
            )}
            {target && (
              <HelpTip label="当前配置文件：说明">
                <div className="help">
                  <div className="help-head"><span className="help-title">{target.label}</span></div>
                  <p className="help-brief">{target.desc}{PAGE_NOTE[page.id] ? `。${PAGE_NOTE[page.id]}` : ''}</p>
                  {target.path && <p className="help-path"><code>{target.path}</code></p>}
                  {file?.exists && <p className="small muted">已设置 {totalSet} 项</p>}
                </div>
              </HelpTip>
            )}
          </div>
          {target && (
            <div className="file-row">
              {target.path ? (
                <>
                  <code className="file-path" title={target.path}>{target.path}</code>
                  {file?.exists && <button className="btn-icon" title="打开所在位置" onClick={() => api.reveal(target.id)}>📂</button>}
                  {!loading && file && !file.exists && <span className="badge badge-muted" title="文件还不存在，保存时自动创建">新文件</span>}
                  {readOnly && file?.data !== null && <span className="badge badge-warn" title="没有写入权限">只读</span>}
                </>
              ) : (
                <button className="btn-link" onClick={() => setModal('project')}>先选择项目目录</button>
              )}
              <span className="spacer" />
              {target.path && !rawOnly && !target.rawDisabled && <button className="btn" onClick={() => setModal('rec')} disabled={!file || readOnly}>★ 推荐配置</button>}
              {target.path && !target.rawDisabled && <button className="btn" onClick={() => setModal('raw')} disabled={!file}>原始文本</button>}
              {target.path && <button className="btn" onClick={() => setModal('backups')}>备份</button>}
            </div>
          )}
        </header>

        {file?.parseError && (
          <div className="alert error">该文件无法解析：{file.parseError}。请用「原始文本」修复后再使用可视化编辑。</div>
        )}

        {rawOnly ? (
          <div className="raw-only">
            <p>requirements.toml 是管理员强制约束文件，结构与 config.toml 不同（如 <code>allowed_approval_policies</code>、<code>allowed_sandbox_modes</code>）。请使用「原始文本」编辑，参考 <a href="https://learn.chatgpt.com/docs/enterprise/managed-configuration" target="_blank" rel="noreferrer">官方托管配置文档 ↗</a>。</p>
            <button className="btn primary" onClick={() => setModal('raw')}>打开原始文本</button>
          </div>
        ) : !target?.path ? null : (
          <>
            <div className="toolbar">
              <input className="search" placeholder="搜索参数" value={search} onChange={(e) => setSearch(e.target.value)} />
              <div className="chips">
                {([['all', '全部'], ['set', '已设置'], ['rec', '推荐'], ['changed', '已修改'], ['new', '新参数']] as [Chip, string][]).map(([k, label]) => (
                  <button key={k} className={`chip ${chip === k ? 'active' : ''}`} onClick={() => setChip(k)}
                    title={k === 'rec' ? '有推荐值、且当前不是推荐值的参数' : k === 'changed' ? '还没保存的修改' : k === 'new' ? '新版本新增、暂无中文说明的参数' : undefined}>{label}</button>
                ))}
              </div>
              <ShowMenu
                options={[
                  { label: '已弃用的参数', checked: showDeprecated, onChange: setShowDeprecated },
                  ...(hasTierItems ? [{ label: '企业 / 内部参数', checked: showEnterprise, onChange: setShowEnterprise }] : []),
                  { label: '其他系统的参数', checked: showOtherOS, onChange: setShowOtherOS },
                  ...(page.id === 'codex-features' ? [{ label: '开发中 / 已移除的开关', checked: showDev, onChange: setShowDev }] : []),
                ]}
              />
            </div>

            <div className="content">
              <nav className="cats">
                {categories.map((c) => (
                  <button key={c.id} className={`cat ${!searching && c.id === activeCat ? 'active' : ''} ${c.id === UNKNOWN_CAT ? 'unknown' : ''}`}
                    onClick={() => { setCat(c.id); if (searching) { setSearch(''); setChip('all'); } }}>
                    <span>{c.name}</span>
                    <span className="cat-count">{c.set ? <b>{c.set}</b> : null}{c.set ? '/' : ''}{c.total}</span>
                  </button>
                ))}
                {!categories.length && <div className="muted small pad">没有匹配的参数</div>}
              </nav>
              <section className="items" ref={listRef}>
                {!catalog || loading ? <div className="muted pad">加载中…</div> : searching ? (
                  <>
                    <div className="result-head">找到 {shown.filter((i) => i.type !== 'group').length} 个参数{shown.length > LIMIT ? `，显示前 ${LIMIT} 个` : ''}</div>
                    {(() => {
                      let n = 0;
                      return grouped.map((g) => {
                        if (n >= LIMIT) return null;
                        const its = g.items.slice(0, LIMIT - n);
                        n += its.length;
                        return (
                          <div key={g.cat} className="cat-block">
                            <h2 className="cat-title">{g.name}</h2>
                            {its.map(renderItem)}
                          </div>
                        );
                      });
                    })()}
                  </>
                ) : (
                  <>
                    {catInfo && (
                      <div className="cat-intro">
                        <h2 className="cat-title">{catInfo.name}</h2>
                        {catDesc && (
                          <HelpTip label={`${catInfo.name}：说明`} wide>
                            <div className="help"><p className="help-brief pre">{catDesc}</p></div>
                          </HelpTip>
                        )}
                      </div>
                    )}
                    {shown.slice(0, 600).map(renderItem)}
                  </>
                )}
                {page.env && !readOnly && (
                  <div className="add-env">
                    <div className="map-row">
                      <input placeholder="新变量名" value={newEnv.k} spellCheck={false} onChange={(e) => setNewEnv({ ...newEnv, k: e.target.value.trim() })} />
                      <span className="map-eq">=</span>
                      <input placeholder="值" value={newEnv.v} spellCheck={false} onChange={(e) => setNewEnv({ ...newEnv, v: e.target.value })} />
                      <button className="btn-small" disabled={!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newEnv.k)} onClick={() => {
                        if (page.id === 'codex-env' && newEnv.k.toUpperCase().startsWith('CODEX_')) {
                          if (!confirm('Codex 会忽略 .env 中以 CODEX_ 开头的变量，仍要添加吗？')) return;
                        }
                        setPath([...basePrefix, newEnv.k], newEnv.v);
                        setNewEnv({ k: '', v: '' });
                        notify('ok', `已添加 ${newEnv.k}（尚未保存）`);
                      }}>+ 添加变量</button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </>
        )}

        {dirty && (
          <footer className="savebar">
            <span><b>{ops.length}</b> 处未保存的修改</span>
            <span className="spacer" />
            <button className="btn" onClick={() => { if (confirm('放弃所有未保存的修改？')) setDraft(original); }}>放弃修改</button>
            <button className="btn primary" onClick={openSave}>查看差异并保存 <kbd>Ctrl/⌘ S</kbd></button>
          </footer>
        )}
      </main>

      {modal === 'save' && saveInfo && target?.path && (
        <SaveModal path={target.path} diff={saveInfo.diff} existed={saveInfo.existed} busy={busy} onClose={() => setModal(null)} onConfirm={doSave} sensitiveMask={page.env} />
      )}
      {modal === 'raw' && target?.path && file && (
        <RawModal
          title="原始文本"
          path={target.path}
          initial={file.text}
          format={target.format}
          readOnly={readOnly && file.data !== null}
          onClose={() => setModal(null)}
          onPreview={async (text) => (await api.preview(target.id, { text, baseHash: file.hash })).diff}
          onSave={async (text) => {
            if (dirty && !confirm('可视化编辑中还有未保存的修改，保存原始文本会丢弃它们。继续？')) return;
            const r = await api.save(target.id, { text, baseHash: file.hash, reason: 'raw' });
            setFile(r.file);
            setDraft((r.file.data as Obj) || {});
            setModal(null);
            notify('ok', '已保存原始文本');
            loadState();
          }}
        />
      )}
      {modal === 'backups' && target?.path && (
        <BackupsModal targetId={target.id} path={target.path} onClose={() => setModal(null)} onRestored={() => { setModal(null); loadFile(); loadState(); notify('ok', '已恢复备份'); }} />
      )}
      {modal === 'rec' && catalog && (
        <RecommendModal
          items={pageItems.filter((i) => i.type !== 'group' && i.type !== 'record')}
          platform={app.platform}
          env={page.env}
          scope={target?.scope}
          getValue={valueOf}
          onClose={() => setModal(null)}
          onApply={(rows) => {
            setDraft((d) => {
              let n = d;
              for (const r of rows) n = setIn(n, keyToPath(r.item.key, basePrefix), r.value);
              return n;
            });
            setModal(null);
            notify('ok', `已应用 ${rows.length} 项推荐值，确认无误后点击保存`);
          }}
        />
      )}
      {modal === 'versions' && (
        <VersionsModal
          versions={versions}
          catalogsMeta={app.catalogs}
          onClose={() => setModal(null)}
          refreshing={refreshing}
          onRefresh={async () => { setRefreshing(true); try { setVersions(await api.versions(true)); } finally { setRefreshing(false); } }}
          syncing={syncing}
          syncResult={syncResult}
          onClearCache={async () => {
            if (!confirm('删除本机同步的参数目录，恢复使用程序自带的版本？')) return;
            try {
              await api.clearCache();
              setSyncResult(null);
              setCatalogs({});
              await loadState();
              notify('ok', '已恢复内置参数目录');
            } catch (e) {
              notify('error', (e as Error).message);
            }
          }}
          onSync={async () => {
            setSyncing(true);
            try {
              const r = await api.sync();
              setSyncResult(r);
              setCatalogs({});
              await loadState();
              notify('ok', '同步完成');
            } catch (e) {
              notify('error', (e as Error).message);
            } finally {
              setSyncing(false);
            }
          }}
        />
      )}
      {modal === 'project' && (
        <ProjectModal current={app.projectDir} recent={app.recentProjects} onClose={() => setModal(null)}
          onSet={async (dir) => {
            if (dirty && !confirm('有未保存的修改，切换项目会丢弃它们。继续？')) return;
            await api.setProject(dir);
            await loadState();
            notify('ok', dir ? '已选择项目目录' : '已清除项目目录');
          }}
          onPick={isDesktop ? async () => {
            if (dirty && !confirm('有未保存的修改，切换项目会丢弃它们。继续？')) return null;
            const r = await api.pickProject();
            if (r.cancelled) return null;
            await loadState();
            notify('ok', '已选择项目目录');
            return r.projectDir;
          } : undefined}
        />
      )}
      {toast && <div className={`toast ${toast.kind}`} onClick={() => setToast(null)}>{toast.text}</div>}
    </div>
  );
}

function platformName(p: string) {
  return p === 'windows' ? 'Windows' : p === 'macos' ? 'macOS' : 'Linux';
}

function shortPath(p: string) {
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : p;
}
