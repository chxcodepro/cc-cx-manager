import { useEffect, useMemo, useState } from 'react';
import type { Item, Platform } from './types';
import { envEncode, envTruthy, formatValue, isPlainObject, recommendedFor, deepEqual, recIsDefault } from './model';
import { HelpTip } from './HelpTip';
import { JsonEditor } from './JsonVisual';
import { FIELD_WHEN, RECORD_MAIN } from './shapes';

const PLATFORM_NAME: Record<string, string> = { windows: 'Windows', macos: 'macOS', linux: 'Linux' };
const SCOPE_NAME: Record<string, string> = { user: '用户', project: '项目', local: '本地', managed: '托管' };
const STAGE_NAME: Record<string, string> = {
  stable: '稳定', experimental: '实验性', 'under development': '开发中', deprecated: '已弃用', removed: '已移除', beta: 'Beta',
};
const TAG_NAME: Record<string, string> = {
  'managed-only': '仅托管', enterprise: '企业', experimental: '实验性', advanced: '高级', security: '安全',
  restart: '需重启', desktop: '桌面端', ide: 'IDE', internal: '内部', undocumented: '未公开', beta: 'Beta', sdk: 'SDK', 'cli-only': '仅 CLI',
  sysenv: '仅系统环境', ref: '配置引用',
};

export interface ItemCtx {
  platform: Platform;
  env: boolean; // env 模式：值一律为字符串
  scope?: string;
  readOnly?: boolean;
}

interface CardProps {
  item: Item;
  value: unknown;
  changed: boolean;
  ctx: ItemCtx;
  onSet: (v: unknown) => void;
  onUnset: () => void;
  compact?: boolean;
  children?: React.ReactNode; // 用于 record 等自定义内容
}

function Badge({ kind, children, title }: { kind: string; children: React.ReactNode; title?: string }) {
  return <span className={`badge badge-${kind}`} title={title}>{children}</span>;
}

function recState(item: Item, value: unknown, ctx: ItemCtx) {
  const rec = recommendedFor(item, ctx.platform);
  const recValue = rec !== undefined && ctx.env ? envEncode(item, rec) : rec;
  const applied = rec !== undefined && value !== undefined
    && (deepEqual(value, recValue) || (ctx.env && item.type === 'boolean' && typeof rec === 'boolean' && envTruthy(value, item) === rec));
  return { rec, recValue, done: applied || recIsDefault(item, value, rec) };
}

/** 「?」弹出层里的标签：阶段、平台、生效范围、其他标签 */
function HelpBadges({ item, ctx }: { item: Item; ctx: ItemCtx }) {
  const out: React.ReactNode[] = [];
  if (item.stage && item.stage !== 'deprecated' && item.stage !== 'removed') out.push(<Badge key="stage" kind={item.stage === 'stable' ? 'ok' : 'exp'}>{STAGE_NAME[item.stage] || item.stage}</Badge>);
  if (item.platforms?.length) out.push(<Badge key="pf" kind={item.platforms.includes(ctx.platform) ? 'pf' : 'warn'}>仅 {item.platforms.map((p) => PLATFORM_NAME[p] || p).join(' / ')}</Badge>);
  if (item.scopes?.length && item.scopes.length < 4) {
    const ok = !ctx.scope || item.scopes.includes(ctx.scope);
    out.push(<Badge key="sc" kind={ok ? 'muted' : 'warn'}>{item.scopes.map((s) => SCOPE_NAME[s] || s).join('/')}配置中生效</Badge>);
  }
  for (const t of item.tags || []) {
    if (t === 'windows' || t === 'macos' || t === 'linux' || (t === 'experimental' && item.stage)) continue;
    out.push(<Badge key={'t' + t} kind={t === 'security' ? 'sec' : t === 'sysenv' ? 'warn' : 'muted'}>{TAG_NAME[t] || t}</Badge>);
  }
  if (item.sensitive) out.push(<Badge key="s" kind="sec">敏感</Badge>);
  return out.length ? <div className="help-tags">{out}</div> : null;
}

/** 参数的「?」说明：一句话效果，加上默认值、推荐值、注意事项；详细说明默认折叠 */
export function ItemHelp({ item, ctx, value, onSet }: { item: Item; ctx: ItemCtx; value: unknown; onSet?: (v: unknown) => void }) {
  const [more, setMore] = useState(false);
  const { rec, recValue, done } = recState(item, value, ctx);
  const brief = item.brief || item.description || item.en || '';
  const detail = item.brief && item.description && item.description !== item.brief ? item.description : '';
  const defaultText = item.default !== undefined ? formatValue(item.default) + (item.unit ? ` ${item.unit}` : '') : undefined;
  const pfNote = item.platformNotes?.[ctx.platform];
  const otherNotes = Object.entries(item.platformNotes || {}).filter(([p]) => p !== ctx.platform);
  const enumDescs = item.enum?.filter((e) => e.description) || [];
  const canFill = item.example !== undefined && value === undefined && !ctx.readOnly && !!onSet && item.type !== 'group';
  const hasMore = !!(detail || enumDescs.length || item.example !== undefined || otherNotes.length || (item.en && item.en !== brief) || item.since || item.docUrl);
  return (
    <div className="help">
      <div className="help-head">
        <span className="help-title">{item.title}</span>
        <code className="help-key" title="点击复制参数名" onClick={() => navigator.clipboard?.writeText(item.key)}>{item.key}</code>
      </div>
      {brief && <p className="help-brief">{brief}</p>}
      {item.untranslated && <p className="help-note">新版本新增的参数，暂时只有官方英文说明。</p>}
      <dl className="help-facts">
        {(defaultText !== undefined || item.defaultNote) && (
          <><dt>默认</dt><dd>{defaultText !== undefined ? <code>{defaultText}</code> : item.defaultNote}{defaultText !== undefined && item.defaultNote ? ` ${item.defaultNote}` : ''}</dd></>
        )}
        {rec !== undefined && (
          <>
            <dt>推荐</dt>
            <dd>
              <code>{formatValue(rec)}</code>{item.recommendedReason && <> {item.recommendedReason}</>}
              {done ? <span className="help-ok"> ✓</span> : !ctx.readOnly && onSet && <> <button className="btn-link" onClick={() => onSet(recValue)}>应用</button></>}
            </dd>
          </>
        )}
        {rec === undefined && item.recommendedReason && <><dt>建议</dt><dd>{item.recommendedReason}</dd></>}
        {pfNote && <><dt>{PLATFORM_NAME[ctx.platform]}</dt><dd>{pfNote}</dd></>}
        {item.deprecated && (
          <>
            <dt className="warn">{item.stage === 'removed' ? '已移除' : '已弃用'}</dt>
            <dd>{item.deprecatedNote || '不再建议使用'}{item.replacedBy && <>，改用 <code>{item.replacedBy}</code></>}</dd>
          </>
        )}
      </dl>
      <HelpBadges item={item} ctx={ctx} />
      {hasMore && <button className="btn-link help-more-btn" onClick={() => setMore(!more)}>{more ? '收起' : '详细说明'}</button>}
      {more && (
        <div className="help-more">
          {detail && <p className="pre">{detail}</p>}
          {enumDescs.length > 0 && (
            <ul className="enum-desc">
              {enumDescs.map((e) => <li key={String(e.value)}><code>{String(e.value)}</code>{e.label && `（${e.label}）`}：{e.description}</li>)}
            </ul>
          )}
          {otherNotes.map(([p, n]) => <p key={p}><b>{PLATFORM_NAME[p] || p}：</b>{n}</p>)}
          {item.example !== undefined && (
            <div>
              <b>示例</b>
              {canFill && <button className="btn-link" onClick={() => onSet!(ctx.env && typeof item.example !== 'string' ? JSON.stringify(item.example) : item.example)}>填入</button>}
              <pre className="example">{typeof item.example === 'string' ? item.example : JSON.stringify(item.example, null, 2)}</pre>
            </div>
          )}
          {item.en && item.en !== brief && <p className="en">{item.en}</p>}
          {item.since && <p>引入版本：{item.since}</p>}
          {item.docUrl && <p><a href={item.docUrl} target="_blank" rel="noreferrer">官方文档 ↗</a></p>}
        </div>
      )}
    </div>
  );
}

export function ItemCard({ item, value, changed, ctx, onSet, onUnset, compact, children }: CardProps) {
  const isSet = value !== undefined;
  const { rec, recValue, done } = recState(item, value, ctx);
  const canRec = rec !== undefined && !done && !ctx.readOnly && !item.deprecated;
  const wide = ['string[]', 'enum[]', 'map', 'json', 'record'].includes(item.type) || !!children;
  const pfMismatch = !!item.platforms?.length && !item.platforms.includes(ctx.platform);
  const scopeMismatch = !!(item.scopes?.length && ctx.scope && !item.scopes.includes(ctx.scope));
  // 开关、下拉框自带「默认」选项，不需要单独的清除按钮
  const hasDefaultChoice = item.type === 'boolean' || (item.type === 'enum' && !!item.enum?.length);
  return (
    <div className={`item ${changed ? 'is-changed' : ''} ${item.deprecated ? 'is-deprecated' : ''} ${compact ? 'is-compact' : ''} ${wide ? 'is-wide' : ''} ${isSet ? 'is-set' : ''}`} id={`item-${item.key}`}>
      <div className="item-head">
        <span className="item-title" title={isSet ? '已在配置文件中设置' : undefined}>{item.title}</span>
        <HelpTip label={`${item.title}：说明`}><ItemHelp item={item} ctx={ctx} value={value} onSet={onSet} /></HelpTip>
        {item.untranslated && <Badge kind="new" title="新版本新增的参数">新</Badge>}
        {item.deprecated && <Badge kind="warn">{item.stage === 'removed' ? '已移除' : '已弃用'}</Badge>}
        {pfMismatch && <Badge kind="warn" title="当前系统不适用">仅 {item.platforms!.map((p) => PLATFORM_NAME[p] || p).join('/')}</Badge>}
        {scopeMismatch && <Badge kind="warn" title="在当前配置文件中不生效">此处无效</Badge>}
        <code className="item-key">{item.key}</code>
      </div>
      <div className="item-ctrl">
        <div className="ctrl-main">{children ?? <Control item={item} value={value} ctx={ctx} onSet={onSet} onUnset={onUnset} />}</div>
        {canRec && (
          <button className="rec-btn" onClick={() => onSet(recValue)}
            title={`应用推荐值：${formatValue(rec)}${item.recommendedReason ? `\n${item.recommendedReason}` : ''}`}>★</button>
        )}
        {isSet && !ctx.readOnly && !children && !hasDefaultChoice && (
          <button className="btn-icon clear-btn" title="清除，恢复默认" onClick={onUnset}>✕</button>
        )}
      </div>
    </div>
  );
}

// ---------------- 控件 ----------------

interface CtrlProps {
  item: Item;
  value: unknown;
  ctx: ItemCtx;
  onSet: (v: unknown) => void;
  onUnset: () => void;
}

export function Control(p: CtrlProps) {
  const { item } = p;
  if (p.ctx.env) {
    if (item.type === 'boolean') return <EnvBool {...p} />;
    if (item.type === 'enum' && item.enum?.length) return <EnumCtrl {...p} />;
    return <TextCtrl {...p} numeric={item.type === 'integer' || item.type === 'number'} />;
  }
  switch (item.type) {
    case 'boolean': return <BoolCtrl {...p} />;
    case 'enum': return <EnumCtrl {...p} />;
    case 'integer':
    case 'number': return <NumberCtrl {...p} />;
    case 'string[]': return <ListCtrl {...p} />;
    case 'enum[]': return <EnumListCtrl {...p} />;
    case 'map': return <MapCtrl {...p} />;
    case 'json':
    case 'record':
    case 'group': return <JsonEditor item={p.item} value={p.value} ctx={p.ctx} onSet={p.onSet} onUnset={p.onUnset} />;
    default: return <TextCtrl {...p} />;
  }
}

function defaultHint(item: Item) {
  return item.default !== undefined ? `默认 ${formatValue(item.default)}` : '';
}

function BoolCtrl({ item, value, onSet, onUnset, ctx }: CtrlProps) {
  const cur = value === undefined ? 'unset' : value === true ? 'on' : value === false ? 'off' : 'other';
  // 未设置时，用虚线框标出默认生效的那一项
  const d = value === undefined ? item.default : undefined;
  const dText = d === true ? '（默认开启）' : d === false ? '（默认关闭）' : '';
  return (
    <div className="seg" role="group">
      <button className={cur === 'unset' ? 'active' : ''} disabled={ctx.readOnly} onClick={onUnset} title={`不写入配置文件，使用默认值${dText}`}>默认</button>
      <button className={`${cur === 'on' ? 'active on' : ''} ${d === true ? 'dflt' : ''}`} disabled={ctx.readOnly} onClick={() => onSet(true)} title={d === true ? '默认就是开启' : undefined}>开启</button>
      <button className={`${cur === 'off' ? 'active off' : ''} ${d === false ? 'dflt' : ''}`} disabled={ctx.readOnly} onClick={() => onSet(false)} title={d === false ? '默认就是关闭' : undefined}>关闭</button>
      {cur === 'other' && <span className="ctrl-other">当前：{formatValue(value)}</span>}
    </div>
  );
}

function EnvBool({ item, value, onSet, onUnset, ctx }: CtrlProps) {
  const t = item.envTrue || '1';
  const f = item.envFalse;
  const s = value === undefined ? undefined : String(value);
  const cur = s === undefined ? 'unset' : s === t || (envTruthy(s, item) && !f) ? 'on' : f && s === f ? 'off' : 'other';
  return (
    <div className="seg" role="group">
      <button className={cur === 'unset' ? 'active' : ''} disabled={ctx.readOnly} onClick={onUnset} title="不写入，使用默认行为">默认</button>
      <button className={cur === 'on' ? 'active on' : ''} disabled={ctx.readOnly} onClick={() => onSet(t)} title={`写入 ${t}`}>启用</button>
      {f !== undefined && <button className={cur === 'off' ? 'active off' : ''} disabled={ctx.readOnly} onClick={() => onSet(f)} title={`写入 ${f}`}>禁用</button>}
      {cur === 'other' && <span className="ctrl-other">当前：{s}</span>}
    </div>
  );
}

function EnumCtrl({ item, value, onSet, onUnset, ctx }: CtrlProps) {
  const opts = item.enum || [];
  const idx = opts.findIndex((o) => (ctx.env ? String(o.value) === String(value) : deepEqual(o.value, value)));
  const custom = value !== undefined && idx < 0;
  return (
    <select
      className="ctrl-select"
      disabled={ctx.readOnly}
      value={value === undefined ? '' : custom ? '__custom' : String(idx)}
      onChange={(e) => {
        const v = e.target.value;
        if (v === '') onUnset();
        else if (v !== '__custom') {
          const o = opts[Number(v)];
          onSet(ctx.env ? String(o.value) : o.value);
        }
      }}
    >
      <option value="">默认{item.default !== undefined ? `（${formatValue(item.default)}）` : ''}</option>
      {opts.map((o, i) => (
        <option key={i} value={String(i)}>{o.label ? `${o.label}（${String(o.value)}）` : String(o.value)}</option>
      ))}
      {custom && <option value="__custom">自定义：{formatValue(value)}</option>}
    </select>
  );
}

function useDraftText(value: unknown, toText: (v: unknown) => string) {
  const [text, setText] = useState(() => toText(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, focused]);
  return { text, setText, focused, setFocused };
}

function TextCtrl({ item, value, onSet, onUnset, ctx, numeric }: CtrlProps & { numeric?: boolean }) {
  const [show, setShow] = useState(false);
  const { text, setText, setFocused } = useDraftText(value, (v) => (v === undefined ? '' : typeof v === 'string' ? v : JSON.stringify(v)));
  const commit = (t: string) => {
    if (t === '' && value === undefined) return;
    if (t === '' && !ctx.env && item.type !== 'string') return onUnset();
    if (t === '' && ctx.env) return onUnset();
    onSet(t);
  };
  return (
    <div className="ctrl-text">
      <input
        type={item.sensitive && !show ? 'password' : 'text'}
        inputMode={numeric ? 'numeric' : undefined}
        value={text}
        placeholder={item.placeholder || defaultHint(item)}
        disabled={ctx.readOnly}
        spellCheck={false}
        autoComplete="off"
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => { setFocused(false); commit(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      {item.sensitive && <button className="btn-icon" onClick={() => setShow(!show)} title={show ? '隐藏' : '显示'}>{show ? '🙈' : '👁'}</button>}
      {item.unit && <span className="unit">{item.unit}</span>}
    </div>
  );
}

function NumberCtrl({ item, value, onSet, onUnset, ctx }: CtrlProps) {
  const { text, setText, setFocused } = useDraftText(value, (v) => (v === undefined ? '' : String(v)));
  const [err, setErr] = useState('');
  const commit = (t: string) => {
    setErr('');
    if (t.trim() === '') { if (value !== undefined) onUnset(); return; }
    const n = Number(t);
    if (!Number.isFinite(n)) { setErr('请输入数字'); return; }
    if (item.type === 'integer' && !Number.isInteger(n)) { setErr('需要整数'); return; }
    if (item.min !== undefined && n < item.min) { setErr(`不能小于 ${item.min}`); return; }
    if (item.max !== undefined && n > item.max) { setErr(`不能大于 ${item.max}`); return; }
    onSet(n);
  };
  return (
    <div className="ctrl-text">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={defaultHint(item)}
        disabled={ctx.readOnly}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => { setFocused(false); commit(e.target.value); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      {item.unit && <span className="unit">{item.unit}</span>}
      {err && <span className="ctrl-err">{err}</span>}
    </div>
  );
}

function ListCtrl({ item, value, onSet, onUnset, ctx }: CtrlProps) {
  const toText = (v: unknown) => (Array.isArray(v) ? v.map(String).join('\n') : typeof v === 'string' ? v : '');
  const { text, setText, setFocused } = useDraftText(value, toText);
  const notArray = value !== undefined && !Array.isArray(value);
  return (
    <div className="ctrl-list">
      <textarea
        rows={Math.min(10, Math.max(2, text.split('\n').length + 1))}
        value={text}
        spellCheck={false}
        disabled={ctx.readOnly}
        placeholder={item.placeholder || (Array.isArray(item.example) ? (item.example as unknown[]).map(String).join('\n') : '每行一项')}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={(e) => {
          setFocused(false);
          const lines = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
          if (!lines.length) { if (value !== undefined) onUnset(); return; }
          if (!deepEqual(lines, value)) onSet(lines);
        }}
      />
      {notArray && <div className="ctrl-hint">当前为单个值，编辑后保存为列表（每行一项）</div>}
    </div>
  );
}

function EnumListCtrl({ item, value, onSet, onUnset, ctx }: CtrlProps) {
  const arr = Array.isArray(value) ? value : [];
  return (
    <div className="ctrl-checks">
      {(item.enum || []).map((o) => {
        const on = arr.some((x) => deepEqual(x, o.value));
        return (
          <label key={String(o.value)} className="check" title={String(o.value)}>
            <input
              type="checkbox"
              checked={on}
              disabled={ctx.readOnly}
              onChange={() => {
                const next = on ? arr.filter((x) => !deepEqual(x, o.value)) : [...arr, o.value];
                if (!next.length) onUnset();
                else onSet(next);
              }}
            />
            <span>{o.label || String(o.value)}</span>
          </label>
        );
      })}
    </div>
  );
}

function MapCtrl(p: CtrlProps) {
  // 值不全是文本时（如对象、开关），交给可视化 JSON 编辑器，避免把值改写成字符串
  const nonText = isPlainObject(p.value) && Object.values(p.value).some((v) => typeof v !== 'string');
  if (nonText) return <JsonEditor item={p.item} value={p.value} ctx={p.ctx} onSet={p.onSet} onUnset={p.onUnset} />;
  return <TextMapCtrl {...p} />;
}

function TextMapCtrl({ item, value, onSet, onUnset, ctx }: CtrlProps) {
  const obj = isPlainObject(value) ? value : {};
  const [rows, setRows] = useState<[string, string][]>(() => Object.entries(obj).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  useEffect(() => {
    setRows(Object.entries(isPlainObject(value) ? value : {}).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  }, [value]);
  const commit = (next: [string, string][]) => {
    const o: Record<string, string> = {};
    for (const [k, v] of next) if (k.trim()) o[k.trim()] = v;
    if (!Object.keys(o).length) { if (value !== undefined) onUnset(); return; }
    if (!deepEqual(o, value)) onSet(o);
  };
  return (
    <div className="ctrl-map">
      {rows.map(([k, v], i) => (
        <div className="map-row" key={i}>
          <input value={k} placeholder="键" disabled={ctx.readOnly} spellCheck={false}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))}
            onBlur={() => commit(rows)} />
          <span className="map-eq">=</span>
          <input value={v} placeholder="值" disabled={ctx.readOnly} spellCheck={false}
            type={item.sensitive ? 'password' : 'text'}
            onChange={(e) => setRows(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))}
            onBlur={() => commit(rows)} />
          {!ctx.readOnly && <button className="btn-icon" title="删除" onClick={() => { const n = rows.filter((_, j) => j !== i); setRows(n); commit(n); }}>✕</button>}
        </div>
      ))}
      {!ctx.readOnly && <button className="btn-small" onClick={() => setRows([...rows, ['', '']])}>+ 添加</button>}
    </div>
  );
}

// ---------------- 记录型（动态键表） ----------------

interface RecordProps {
  item: Item;
  value: unknown;
  fields: Item[]; // 字段定义（key 为相对路径，fullKey 为目录中的完整键）
  ctx: ItemCtx;
  changedFn: (path: string[]) => boolean;
  basePath: string[];
  onSetPath: (path: string[], v: unknown) => void;
  onUnsetPath: (path: string[]) => void;
  onRename: (path: string[], to: string) => void;
  /** 目录中单独定义的固定子键（如 plugins._default），不作为条目显示 */
  reserved?: string[];
}

const fieldValue = (entry: unknown, key: string) => {
  let v: unknown = entry;
  for (const seg of key.split('.')) v = isPlainObject(v) ? v[seg] : undefined;
  return v;
};

export function RecordEditor({ item, value, fields, ctx, changedFn, basePath, onSetPath, onUnsetPath, onRename, reserved = [] }: RecordProps) {
  const obj = isPlainObject(value) ? value : {};
  const names = Object.keys(obj).filter((n) => !reserved.includes(n));
  const [adding, setAdding] = useState('');
  const [openSet, setOpenSet] = useState<Set<string>>(new Set());
  const [allSet, setAllSet] = useState<Set<string>>(new Set());
  // 分组项只是标题，不单独编辑（其下的字段会逐个列出）
  const editable = useMemo(() => fields.filter((f) => f.type !== 'group'), [fields]);
  const fieldKeys = useMemo(() => new Set(fields.map((f) => f.key.split('.')[0])), [fields]);
  const mainKeys = RECORD_MAIN[item.fullKey || item.key];
  // 只有一个简单字段的记录（如插件只有「启用」）：每个条目一行
  const single = editable.length === 1 && ['boolean', 'enum', 'string', 'integer', 'number'].includes(editable[0].type) ? editable[0] : null;
  const flip = (s: Set<string>, n: string) => { const c = new Set(s); c.has(n) ? c.delete(n) : c.add(n); return c; };

  const actions = (name: string) => !ctx.readOnly && (
    <span className="record-actions" onClick={(e) => e.stopPropagation()}>
      <button className="btn-link" onClick={() => {
        const to = prompt('新名称', name);
        if (to && to !== name) {
          if (to in obj) alert('已存在同名条目');
          else onRename([...basePath, name], to);
        }
      }}>重命名</button>
      <button className="btn-link danger" onClick={() => { if (confirm(`删除「${name}」整个条目？`)) onUnsetPath([...basePath, name]); }}>删除</button>
    </span>
  );

  return (
    <div className="record">
      {names.map((name) => {
        const entry = obj[name];
        const entryObj = isPlainObject(entry) ? entry : {};

        if (single) {
          const p = [...basePath, name, ...single.key.split('.')];
          return (
            <div className={`record-line ${changedFn([...basePath, name]) ? 'is-changed' : ''}`} key={name}>
              <code className="record-name" title={name}>{name}</code>
              <span className="spacer" />
              <Control item={single} value={fieldValue(entryObj, single.key)} ctx={ctx} onSet={(nv) => onSetPath(p, nv)} onUnset={() => onUnsetPath(p)} />
              {actions(name)}
            </div>
          );
        }

        const extra = Object.fromEntries(Object.entries(entryObj).filter(([k]) => !fieldKeys.has(k)));
        const open = openSet.has(name);
        const isSetF = (f: Item) => fieldValue(entryObj, f.key) !== undefined;
        const visible = editable.filter((f) => {
          const when = FIELD_WHEN[f.fullKey || ''];
          return isSetF(f) || !when || when(entryObj);
        });
        const showAll = !mainKeys || allSet.has(name);
        const shown = showAll ? visible : visible.filter((f) => isSetF(f) || mainKeys!.includes(f.key));
        const hidden = visible.length - shown.length;
        const setCount = Object.keys(entryObj).length;
        return (
          <div className={`record-entry ${changedFn([...basePath, name]) ? 'is-changed' : ''}`} key={name}>
            <div className="record-head" onClick={() => setOpenSet((cur) => flip(cur, name))}>
              <span className="caret">{open ? '▾' : '▸'}</span>
              <code className="record-name">{name}</code>
              <span className="record-sum">{setCount} 项</span>
              {actions(name)}
            </div>
            {open && (
              <div className="record-body">
                {!isPlainObject(entry) && <div className="item-note warn">该条目不是表/对象，值为 {formatValue(entry)}</div>}
                {shown.map((f) => {
                  const p = [...basePath, name, ...f.key.split('.')];
                  return (
                    <ItemCard key={f.key} item={f} value={fieldValue(entryObj, f.key)} changed={changedFn(p)} ctx={ctx} compact
                      onSet={(nv) => onSetPath(p, nv)} onUnset={() => onUnsetPath(p)} />
                  );
                })}
                {(hidden > 0 || (mainKeys && allSet.has(name))) && (
                  <button className="btn-link record-more" onClick={() => setAllSet((cur) => flip(cur, name))}>
                    {allSet.has(name) ? '只显示常用字段' : `更多字段（${hidden}）`}
                  </button>
                )}
                {Object.keys(extra).length > 0 && (
                  <div className="record-extra">
                    <div className="record-extra-title" title="参数目录中没有定义的字段，会原样保留">其他字段</div>
                    <JsonEditor
                      item={{ key: '', title: '其他字段', category: '', type: 'json' }}
                      shape={{ t: 'map', of: { t: 'any' }, keyPh: '字段名' }}
                      value={extra}
                      ctx={ctx}
                      onSet={(nv) => {
                        if (!isPlainObject(nv)) return;
                        for (const k of Object.keys(extra)) if (!(k in nv)) onUnsetPath([...basePath, name, k]);
                        for (const [k, vv] of Object.entries(nv)) onSetPath([...basePath, name, k], vv);
                      }}
                      onUnset={() => { for (const k of Object.keys(extra)) onUnsetPath([...basePath, name, k]); }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
      {!ctx.readOnly && (
        <div className="record-add">
          <input value={adding} placeholder={names.length ? `新${item.title}名称` : `还没有${item.title}，输入名称新增`} spellCheck={false} onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget.nextSibling as HTMLButtonElement)?.click(); }} />
          <button className="btn-small" disabled={!adding.trim() || adding.trim() in obj} onClick={() => {
            const n = adding.trim();
            onSetPath([...basePath, n], {});
            setOpenSet(new Set([...openSet, n]));
            setAdding('');
          }}>+ 新增</button>
        </div>
      )}
      {ctx.readOnly && names.length === 0 && <div className="record-empty">暂无条目</div>}
    </div>
  );
}
