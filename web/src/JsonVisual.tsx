// 可视化 JSON 编辑器：按结构定义（shapes.ts）或现有内容，把 JSON 显示成表单、列表和卡片
// 任何时候都可以切换到「JSON」文本模式；两种模式编辑的是同一个值
import { useEffect, useMemo, useState } from 'react';
import type { Item } from './types';
import { type Field, type Opt, type Shape, labelOf, shapeFor } from './shapes';
import { HelpTip } from './HelpTip';
import { deepEqual } from './model';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === 'object' && !Array.isArray(v);

interface Ctx { readOnly?: boolean }

interface NodeProps {
  shape: Shape;
  value: unknown;
  onChange: (v: unknown) => void; // 传 undefined 表示删除
  ro?: boolean;
  depth: number;
  /** 作为对象的可选字段：开关多一个「默认」，下拉多一个「未设置」 */
  optional?: boolean;
}

// ---------------- 工具函数 ----------------

function initial(shape: Shape, template?: () => unknown): unknown {
  if (template) return template();
  switch (shape.t) {
    case 'string': return shape.enum && !shape.free ? shape.enum[0]?.v ?? '' : '';
    case 'number': return 0;
    case 'boolean': return true;
    case 'list': return [];
    case 'map': return {};
    case 'object': return {};
    case 'union': return initial(shape.of[0]);
    default: return '';
  }
}

function matches(shape: Shape, v: unknown): boolean {
  switch (shape.t) {
    case 'string': return typeof v === 'string';
    case 'number': return typeof v === 'number';
    case 'boolean': return typeof v === 'boolean';
    case 'list': return Array.isArray(v);
    case 'map': case 'object': return isObj(v);
    case 'union': return shape.of.some((s) => matches(s, v));
    default: return true;
  }
}

function pickVariant(of: Shape[], v: unknown): Shape | undefined {
  return of.find((s) => s.t !== 'any' && matches(s, v)) ?? of.find((s) => s.t === 'any');
}

const SIMPLE = new Set(['string', 'number', 'boolean']);
const isSimple = (s: Shape) => SIMPLE.has(s.t);

function typeName(s: Shape): string {
  switch (s.t) {
    case 'string': return s.enum && !s.free ? '选项' : '文本';
    case 'number': return '数字';
    case 'boolean': return '开关';
    case 'list': return '列表';
    case 'map': case 'object': return '对象';
    default: return '值';
  }
}

function short(v: unknown): string {
  if (v === undefined) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 60) + '…' : s;
}

function summarize(shape: Shape, v: unknown): string {
  if (shape.t === 'object' && shape.summary && isObj(v)) return shape.summary(v);
  if (shape.t === 'union') {
    const s = pickVariant(shape.of, v);
    if (s && s.t !== 'union') return summarize(s, v);
  }
  // 只有一项时直接显示这一项的摘要，更直观
  if (Array.isArray(v) && v.length === 1 && shape.t === 'list') {
    const one = summarize(shape.of, v[0]);
    if (one) return one;
  }
  if (Array.isArray(v)) return `${v.length} 项`;
  if (isObj(v)) return `${Object.keys(v).length} 项`;
  return short(v);
}

// ---------------- 基础输入 ----------------

function useDraft(value: string) {
  const [text, setText] = useState(value);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setText(value); }, [value, focused]);
  return { text, setText, focused, setFocused };
}

function TextBox({ value, onCommit, ph, secret, long, ro, listId }: {
  value: string; onCommit: (v: string) => void; ph?: string; secret?: boolean; long?: boolean; ro?: boolean; listId?: string;
}) {
  const { text, setText, setFocused } = useDraft(value);
  const [show, setShow] = useState(false);
  const commit = (t: string) => { setFocused(false); if (t !== value) onCommit(t); };
  if (long) {
    return (
      <textarea className="jv-input" rows={Math.min(8, Math.max(1, text.split('\n').length))} value={text} placeholder={ph} disabled={ro} spellCheck={false}
        onFocus={() => setFocused(true)} onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)} />
    );
  }
  return (
    <span className="jv-text">
      <input className="jv-input" type={secret && !show ? 'password' : 'text'} value={text} placeholder={ph} disabled={ro} spellCheck={false} autoComplete="off" list={listId}
        onFocus={() => setFocused(true)} onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {secret && <button className="btn-icon" title={show ? '隐藏' : '显示'} onClick={() => setShow(!show)}>{show ? '🙈' : '👁'}</button>}
    </span>
  );
}

function NumberBox({ value, onCommit, ph, unit, int, ro }: { value: number | undefined; onCommit: (v: number | undefined) => void; ph?: string; unit?: string; int?: boolean; ro?: boolean }) {
  const { text, setText, setFocused } = useDraft(value === undefined ? '' : String(value));
  const [err, setErr] = useState(false);
  const commit = (t: string) => {
    setFocused(false);
    if (t.trim() === '') { setErr(false); if (value !== undefined) onCommit(undefined); return; }
    const n = Number(t);
    if (!Number.isFinite(n) || (int && !Number.isInteger(n))) { setErr(true); return; }
    setErr(false);
    if (n !== value) onCommit(n);
  };
  return (
    <span className="jv-text">
      <input className={`jv-input jv-num ${err ? 'bad' : ''}`} inputMode="decimal" value={text} placeholder={ph} disabled={ro}
        title={err ? (int ? '需要整数' : '请输入数字') : undefined}
        onFocus={() => setFocused(true)} onChange={(e) => setText(e.target.value)} onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {unit && <span className="unit">{unit}</span>}
    </span>
  );
}

function BoolSeg({ value, onChange, optional, ro }: { value: unknown; onChange: (v: unknown) => void; optional?: boolean; ro?: boolean }) {
  return (
    <div className="seg seg-sm" role="group">
      {optional && <button className={value === undefined ? 'active' : ''} disabled={ro} onClick={() => onChange(undefined)}>默认</button>}
      <button className={value === true ? 'active on' : ''} disabled={ro} onClick={() => onChange(true)}>开启</button>
      <button className={value === false ? 'active off' : ''} disabled={ro} onClick={() => onChange(false)}>关闭</button>
    </div>
  );
}

function EnumSelect({ opts, value, onChange, optional, ro }: { opts: Opt[]; value: unknown; onChange: (v: unknown) => void; optional?: boolean; ro?: boolean }) {
  const has = opts.some((o) => o.v === value);
  return (
    <select className="jv-input jv-select" value={value === undefined ? '' : has ? String(value) : '__other'} disabled={ro}
      onChange={(e) => { const v = e.target.value; if (v === '') onChange(undefined); else if (v !== '__other') onChange(v); }}>
      {(optional || value === undefined) && <option value="">（未设置）</option>}
      {opts.map((o) => <option key={o.v} value={o.v}>{o.l ? `${o.l}（${o.v}）` : o.v}</option>)}
      {value !== undefined && !has && <option value="__other">{String(value)}</option>}
    </select>
  );
}

let listSeq = 0;

// ---------------- 节点 ----------------

function Node(p: NodeProps) {
  const { shape, value, onChange, ro, optional } = p;
  switch (shape.t) {
    case 'string': {
      if (value !== undefined && typeof value !== 'string') return <AnyNode {...p} />;
      if (shape.enum && !shape.free) return <EnumSelect opts={shape.enum} value={value} onChange={onChange} optional={optional} ro={ro} />;
      return <FreeText shape={shape} value={value} onChange={onChange} ro={ro} optional={optional} />;
    }
    case 'number':
      if (value !== undefined && typeof value !== 'number') return <AnyNode {...p} />;
      return <NumberBox value={value as number | undefined} onCommit={(v) => onChange(v)} ph={shape.ph} unit={shape.unit} int={shape.int} ro={ro} />;
    case 'boolean':
      if (value !== undefined && typeof value !== 'boolean') return <AnyNode {...p} />;
      return <BoolSeg value={value} onChange={onChange} optional={optional} ro={ro} />;
    case 'list':
      if (value !== undefined && !Array.isArray(value)) return <AnyNode {...p} />;
      return <ListNode {...p} shape={shape} />;
    case 'map':
      if (value !== undefined && !isObj(value)) return <AnyNode {...p} />;
      return <MapNode {...p} shape={shape} />;
    case 'object':
      if (value !== undefined && !isObj(value)) return <AnyNode {...p} />;
      return <ObjectNode {...p} shape={shape} />;
    case 'union':
      return <UnionNode {...p} shape={shape} />;
    default:
      return <AnyNode {...p} />;
  }
}

function FreeText({ shape, value, onChange, ro, optional }: { shape: Extract<Shape, { t: 'string' }>; value: unknown; onChange: (v: unknown) => void; ro?: boolean; optional?: boolean }) {
  const listId = useMemo(() => (shape.enum ? `jv-dl-${++listSeq}` : undefined), [shape.enum]);
  return (
    <>
      <TextBox value={(value as string | undefined) ?? ''} onCommit={(t) => onChange(t === '' && optional ? undefined : t)}
        ph={shape.ph ?? (shape.enum ? shape.enum.map((o) => o.v).slice(0, 3).join(' / ') : undefined)} secret={shape.secret} long={shape.long} ro={ro} listId={listId} />
      {listId && <datalist id={listId}>{shape.enum!.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}</datalist>}
    </>
  );
}

/** 没有结构定义时，按值的类型显示；未设置时让用户选类型 */
function AnyNode({ value, onChange, ro, depth, optional }: NodeProps) {
  if (value === undefined) {
    if (ro) return <span className="muted small">未设置</span>;
    return <TypePicker onPick={(v) => onChange(v)} />;
  }
  if (Array.isArray(value)) return <ListNode shape={{ t: 'list', of: { t: 'any' } }} value={value} onChange={onChange} ro={ro} depth={depth} />;
  if (isObj(value)) return <MapNode shape={{ t: 'map', of: { t: 'any' } }} value={value} onChange={onChange} ro={ro} depth={depth} />;
  if (typeof value === 'boolean') return <BoolSeg value={value} onChange={onChange} optional={optional} ro={ro} />;
  if (typeof value === 'number') return <NumberBox value={value} onCommit={(v) => onChange(v)} ro={ro} />;
  if (typeof value === 'string') return <TextBox value={value} onCommit={(t) => onChange(t)} long={value.includes('\n')} ro={ro} />;
  return <code className="small">{JSON.stringify(value)}</code>;
}

const PICK_TYPES: [string, unknown][] = [['文本', ''], ['数字', 0], ['开关', true], ['列表', []], ['对象', {}]];

function TypePicker({ onPick, label = '设置为' }: { onPick: (v: unknown) => void; label?: string }) {
  return (
    <span className="jv-pick">
      <span className="muted small">{label}</span>
      {PICK_TYPES.map(([l, v]) => <button key={l} className="btn-small" onClick={() => onPick(structuredClone(v))}>{l}</button>)}
    </span>
  );
}

function UnionNode({ shape, value, onChange, ro, depth, optional }: NodeProps & { shape: Extract<Shape, { t: 'union' }> }) {
  if (value === undefined) {
    if (ro) return <span className="muted small">未设置</span>;
    const named = shape.of.filter((s) => s.t !== 'any');
    return (
      <span className="jv-pick">
        <span className="muted small">设置为</span>
        {named.map((s, i) => <button key={i} className="btn-small" onClick={() => onChange(initial(s))}>{typeName(s)}</button>)}
      </span>
    );
  }
  const s = pickVariant(shape.of, value);
  return s ? <Node shape={s} value={value} onChange={onChange} ro={ro} depth={depth} optional={optional} /> : <AnyNode shape={{ t: 'any' }} value={value} onChange={onChange} ro={ro} depth={depth} />;
}

// ---------------- 卡片 ----------------

function Card({ title, summary, children, open, onToggle, actions }: {
  title: React.ReactNode; summary?: string; children: React.ReactNode; open: boolean; onToggle: () => void; actions?: React.ReactNode;
}) {
  return (
    <div className={`jv-card ${open ? 'open' : ''}`}>
      <div className="jv-card-head" onClick={onToggle}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        <span className="jv-card-title">{title}</span>
        {summary && <span className="jv-card-sum">{summary}</span>}
        {actions && <span className="jv-actions" onClick={(e) => e.stopPropagation()}>{actions}</span>}
      </div>
      {open && <div className="jv-card-body">{children}</div>}
    </div>
  );
}

function useOpenSet(initialOpen: string[]) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(initialOpen));
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const add = (k: string) => setOpen((s) => new Set(s).add(k));
  return { open, toggle, add };
}

// ---------------- 列表 ----------------

function ListNode({ shape, value, onChange, ro, depth }: NodeProps & { shape: Extract<Shape, { t: 'list' }> }) {
  const arr = Array.isArray(value) ? value : [];
  const of = shape.of;
  const plainStrings = ((of.t === 'string' && !of.enum && !of.long && !of.secret) || (of.t === 'any' && arr.length > 0)) && arr.every((x) => typeof x === 'string');
  const { open, toggle, add: openKey } = useOpenSet(arr.length === 1 ? ['0'] : []);

  const setAt = (i: number, v: unknown) => {
    const n = [...arr];
    if (v === undefined) n.splice(i, 1);
    else n[i] = v;
    onChange(n);
  };
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= arr.length) return;
    const n = [...arr];
    [n[i], n[j]] = [n[j], n[i]];
    onChange(n);
  };
  const append = (v: unknown) => {
    onChange([...arr, v]);
    openKey(String(arr.length));
  };

  // 纯文本列表：一行一项，最省地方
  if (plainStrings) {
    return <LinesBox value={arr as string[]} ph={shape.ph} ro={ro} onChange={(lines) => onChange(lines)} />;
  }

  const rowAt = (v: unknown) => isSimple(of) || ((of.t === 'any' || of.t === 'union') && !isObj(v) && !Array.isArray(v));
  const actions = (i: number) => !ro && (
    <>
      <button className="btn-icon" title="上移" disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
      <button className="btn-icon" title="下移" disabled={i === arr.length - 1} onClick={() => move(i, 1)}>↓</button>
      <button className="btn-icon" title="删除" onClick={() => setAt(i, undefined)}>✕</button>
    </>
  );
  return (
    <div className="jv-list">
      {arr.map((v, i) => rowAt(v) ? (
        <div className="jv-row" key={i}>
          <div className="jv-row-val"><Node shape={of} value={v} onChange={(nv) => setAt(i, nv)} ro={ro} depth={depth + 1} /></div>
          <span className="jv-actions">{actions(i)}</span>
        </div>
      ) : (
        <Card key={i} title={`第 ${i + 1} 项`} summary={summarize(of, v)} open={open.has(String(i))} onToggle={() => toggle(String(i))} actions={actions(i)}>
          <Node shape={of} value={v} onChange={(nv) => setAt(i, nv)} ro={ro} depth={depth + 1} />
        </Card>
      ))}
      {arr.length === 0 && value !== undefined && <div className="muted small">（空列表）</div>}
      {!ro && (of.t === 'any'
        ? <TypePicker label="添加" onPick={append} />
        : <button className="btn-small jv-add-btn" onClick={() => append(initial(of, shape.template))}>+ {shape.add || '添加一项'}</button>)}
    </div>
  );
}

function LinesBox({ value, onChange, ph, ro }: { value: string[]; onChange: (v: string[]) => void; ph?: string; ro?: boolean }) {
  const joined = value.join('\n');
  const { text, setText, setFocused } = useDraft(joined);
  return (
    <textarea className="jv-input" rows={Math.min(10, Math.max(2, text.split('\n').length + 1))} value={text} placeholder={ph || '每行一项'} disabled={ro} spellCheck={false}
      onFocus={() => setFocused(true)} onChange={(e) => setText(e.target.value)}
      onBlur={(e) => {
        setFocused(false);
        const lines = e.target.value.split('\n').map((s) => s.trim()).filter(Boolean);
        if (!deepEqual(lines, value)) onChange(lines);
      }} />
  );
}

// ---------------- 键值表 ----------------

function MapNode({ shape, value, onChange, ro, depth }: NodeProps & { shape: Extract<Shape, { t: 'map' }> }) {
  const obj = isObj(value) ? value : {};
  const keys = Object.keys(obj);
  const of = shape.of;
  const rowAt = (v: unknown) => isSimple(of) || (of.t === 'any' && !isObj(v) && !Array.isArray(v));
  const { open, toggle, add: openKey } = useOpenSet(keys.length === 1 ? keys : []);

  const setEntry = (k: string, v: unknown) => {
    if (v === undefined) {
      const n = { ...obj };
      delete n[k];
      onChange(n);
    } else onChange({ ...obj, [k]: v });
  };
  const rename = (from: string, to: string) => {
    if (!to || to === from || to in obj) return;
    const n: Obj = {};
    for (const [k, v] of Object.entries(obj)) n[k === from ? to : k] = v;
    onChange(n);
  };
  const addKey = (k: string, v: unknown) => {
    if (!k || k in obj) return;
    onChange({ ...obj, [k]: v });
    openKey(k);
  };

  return (
    <div className="jv-map">
      {keys.map((k) => {
        const label = labelOf(shape.keyEnum, k);
        const del = !ro && <button className="btn-icon" title="删除" onClick={() => setEntry(k, undefined)}>✕</button>;
        if (rowAt(obj[k])) {
          return (
            <div className="jv-row" key={k}>
              <KeyBox k={k} label={label} ro={ro || !!shape.keyEnum} onRename={(to) => rename(k, to)} />
              <div className="jv-row-val"><Node shape={of} value={obj[k]} onChange={(v) => setEntry(k, v)} ro={ro} depth={depth + 1} /></div>
              <span className="jv-actions">{del}</span>
            </div>
          );
        }
        return (
          <Card key={k} open={open.has(k)} onToggle={() => toggle(k)} summary={summarize(of, obj[k])}
            title={<>{label && <span className="jv-key-label">{label}</span>}<code className="jv-key">{k}</code></>}
            actions={<>
              {!ro && !shape.keyEnum && <button className="btn-icon" title="重命名" onClick={() => { const to = prompt('新名称', k); if (to) rename(k, to.trim()); }}>✎</button>}
              {del}
            </>}>
            <Node shape={of} value={obj[k]} onChange={(v) => setEntry(k, v)} ro={ro} depth={depth + 1} />
          </Card>
        );
      })}
      {keys.length === 0 && value !== undefined && <div className="muted small">（空）</div>}
      {!ro && <AddKey shape={shape} exclude={keys} onAdd={addKey} />}
    </div>
  );
}

function KeyBox({ k, label, ro, onRename }: { k: string; label?: string; ro?: boolean; onRename: (to: string) => void }) {
  const { text, setText, setFocused } = useDraft(k);
  if (ro) return <span className="jv-keycell" title={k}>{label ? <><span className="jv-key-label">{label}</span><code className="jv-key">{k}</code></> : <code className="jv-key">{k}</code>}</span>;
  return (
    <input className="jv-input jv-keyinput" value={text} spellCheck={false} title="名称（可直接修改）"
      onFocus={() => setFocused(true)} onChange={(e) => setText(e.target.value)}
      onBlur={(e) => { setFocused(false); const t = e.target.value.trim(); if (t && t !== k) onRename(t); else setText(k); }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

function AddKey({ shape, exclude, onAdd }: { shape: Extract<Shape, { t: 'map' }>; exclude: string[]; onAdd: (k: string, v: unknown) => void }) {
  const [k, setK] = useState('');
  const [manual, setManual] = useState(false);
  const left = shape.keyEnum?.filter((o) => !exclude.includes(o.v)) ?? [];
  const value = () => initial(shape.of, shape.template);
  if (shape.keyEnum && !manual) {
    return (
      <div className="jv-add">
        <select className="jv-input jv-select" value="" onChange={(e) => {
          const v = e.target.value;
          if (v === '__manual') setManual(true);
          else if (v) onAdd(v, value());
        }}>
          <option value="">+ {shape.add || '添加'}…</option>
          {left.map((o) => <option key={o.v} value={o.v}>{o.l ? `${o.l}（${o.v}）` : o.v}</option>)}
          <option value="__manual">其他（手动输入名称）</option>
        </select>
      </div>
    );
  }
  const ok = !!k.trim() && !exclude.includes(k.trim());
  const commit = (v: unknown) => { if (!ok) return; onAdd(k.trim(), v); setK(''); };
  return (
    <div className="jv-add">
      <input className="jv-input" value={k} placeholder={shape.keyPh || '名称'} spellCheck={false} onChange={(e) => setK(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && shape.of.t !== 'any') commit(value()); }} />
      {shape.of.t === 'any'
        ? PICK_TYPES.map(([l, v]) => <button key={l} className="btn-small" disabled={!ok} onClick={() => commit(structuredClone(v))}>+ {l}</button>)
        : <button className="btn-small" disabled={!ok} onClick={() => commit(value())}>+ {shape.add || '添加'}</button>}
    </div>
  );
}

// ---------------- 对象（已知字段） ----------------

function ObjectNode({ shape, value, onChange, ro, depth }: NodeProps & { shape: Extract<Shape, { t: 'object' }> }) {
  const obj = isObj(value) ? value : {};
  const [more, setMore] = useState(false);
  // 有值的字段总是显示；没有值的字段按 when 条件显示，高级字段收进「更多字段」
  const visible = shape.fields.filter((f) => obj[f.k] !== undefined || !f.when || f.when(obj));
  const shown = visible.filter((f) => !f.adv || obj[f.k] !== undefined || more);
  const hiddenFields = visible.filter((f) => f.adv && obj[f.k] === undefined);
  const hidden = hiddenFields.length;
  // 收起的字段不多时直接列出名称，比「更多字段（N）」更清楚
  const moreLabel = hidden <= 3 ? `+ ${hiddenFields.map((f) => f.label).join('、')}` : `更多字段（${hidden}）`;
  const known = new Set(shape.fields.map((f) => f.k));
  const extras = Object.keys(obj).filter((k) => !known.has(k));

  const setField = (k: string, v: unknown) => {
    const n = { ...obj };
    if (v === undefined) delete n[k];
    else n[k] = v;
    onChange(n);
  };

  return (
    <div className="jv-obj">
      {shown.map((f) => <FieldRow key={f.k} f={f} value={obj[f.k]} onChange={(v) => setField(f.k, v)} ro={ro} depth={depth} />)}
      {extras.map((k) => (
        <FieldRow key={k} f={{ k, label: k, s: { t: 'any' } }} value={obj[k]} onChange={(v) => setField(k, v)} ro={ro} depth={depth} />
      ))}
      {hidden > 0 && (
        <button className="btn-link jv-more" onClick={() => setMore(!more)}>{more ? '收起不常用的字段' : moreLabel}</button>
      )}
    </div>
  );
}

function FieldRow({ f, value, onChange, ro, depth }: { f: Field; value: unknown; onChange: (v: unknown) => void; ro?: boolean; depth: number }) {
  const wide = !isSimple(f.s) && !(f.s.t === 'union' && f.s.of.every(isSimple)) && value !== undefined && (isObj(value) || Array.isArray(value));
  const selfClears = f.s.t === 'boolean' || (f.s.t === 'string' && !!f.s.enum && !f.s.free);
  return (
    <div className={`jv-field ${wide ? 'wide' : ''}`}>
      <div className="jv-label">
        <span title={f.k}>{f.label}</span>
        {f.hint && <HelpTip label={`${f.label}：说明`}><div className="help"><p className="help-brief">{f.hint}</p><p className="small muted"><code>{f.k}</code></p></div></HelpTip>}
      </div>
      <div className="jv-val"><Node shape={f.s} value={value} onChange={onChange} ro={ro} depth={depth + 1} optional /></div>
      <span className="jv-actions">{value !== undefined && !ro && !selfClears && <button className="btn-icon" title="清除" onClick={() => onChange(undefined)}>✕</button>}</span>
    </div>
  );
}

// ---------------- 对外组件 ----------------

/** JSON 文本编辑（「JSON」模式，也用于没有可视化的场景） */
export function JsonText({ item, value, ro, onSet, onUnset }: { item: Item; value: unknown; ro?: boolean; onSet: (v: unknown) => void; onUnset: () => void }) {
  const toText = (v: unknown) => (v === undefined ? '' : JSON.stringify(v, null, 2));
  const { text, setText, setFocused } = useDraft(toText(value));
  const [err, setErr] = useState('');
  const rows = Math.min(18, Math.max(3, text.split('\n').length + 1));
  return (
    <div className="ctrl-json">
      <textarea
        rows={rows}
        value={text}
        spellCheck={false}
        disabled={ro}
        placeholder={item.example !== undefined ? JSON.stringify(item.example, null, 2) : 'JSON'}
        onFocus={() => setFocused(true)}
        onChange={(e) => { setText(e.target.value); setErr(''); }}
        onBlur={(e) => {
          setFocused(false);
          const t = e.target.value.trim();
          if (!t) { if (value !== undefined) onUnset(); return; }
          try {
            const v = JSON.parse(t);
            setErr('');
            if (!deepEqual(v, value)) onSet(v);
          } catch (ex) {
            setErr('JSON 格式错误：' + (ex as Error).message);
          }
        }}
      />
      {err && <div className="ctrl-err">{err}</div>}
    </div>
  );
}

const MODE_KEY = 'ccm.jsonMode';

/** 可视化 JSON 编辑器：默认可视化，右上角可切到 JSON 文本 */
export function JsonEditor({ item, value, ctx, onSet, onUnset, shape: given }: {
  item: Item; value: unknown; ctx: Ctx; onSet: (v: unknown) => void; onUnset: () => void; shape?: Shape;
}) {
  const shape = useMemo(() => given ?? shapeFor(item), [given, item]);
  const [raw, setRaw] = useState(() => {
    try { return localStorage.getItem(MODE_KEY) === 'json'; } catch { return false; }
  });
  const setMode = (json: boolean) => {
    setRaw(json);
    try { localStorage.setItem(MODE_KEY, json ? 'json' : 'visual'); } catch { /* 忽略 */ }
  };
  const change = (v: unknown) => (v === undefined ? onUnset() : onSet(v));
  const canFill = value === undefined && item.example !== undefined && !ctx.readOnly;
  const fill = canFill && <button className="btn-small" onClick={() => onSet(structuredClone(item.example))}>填入示例</button>;
  // 未设置时收成一行：添加按钮 + 填入示例，切换按钮鼠标移上来才显示
  const compact = value === undefined && !raw && (shape?.t ?? 'any') !== 'object';
  const toggle = (
    <div className={compact ? 'seg seg-sm jv-hover' : 'seg seg-sm'} role="group" title="切换编辑方式">
      <button className={!raw ? 'active' : ''} onClick={() => setMode(false)}>可视化</button>
      <button className={raw ? 'active' : ''} onClick={() => setMode(true)}>JSON</button>
    </div>
  );
  if (compact) {
    return (
      <div className="jv jv-empty">
        <Node shape={shape ?? { t: 'any' }} value={value} onChange={change} ro={ctx.readOnly} depth={0} />
        {fill}
        <span className="spacer" />
        {toggle}
      </div>
    );
  }
  return (
    <div className="jv">
      <div className="jv-top">
        {fill}
        <span className="spacer" />
        {toggle}
      </div>
      {raw
        ? <JsonText item={item} value={value} ro={ctx.readOnly} onSet={onSet} onUnset={onUnset} />
        : <Node shape={shape ?? { t: 'any' }} value={value} onChange={change} ro={ctx.readOnly} depth={0} />}
    </div>
  );
}
