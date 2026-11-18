// 行级差异（Myers 算法），输出带上下文的 hunk，供前端预览
export function diffLines(a, b) {
  const A = a.replace(/\r\n/g, '\n').split('\n');
  const B = b.replace(/\r\n/g, '\n').split('\n');
  const N = A.length;
  const M = B.length;
  const max = N + M;
  const v = new Map([[1, 0]]);
  const trace = [];
  outer: for (let d = 0; d <= max; d++) {
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x;
      if (k === -d || (k !== d && (v.get(k - 1) ?? -1) < (v.get(k + 1) ?? -1))) x = v.get(k + 1) ?? 0;
      else x = (v.get(k - 1) ?? 0) + 1;
      let y = x - k;
      while (x < N && y < M && A[x] === B[y]) { x++; y++; }
      v.set(k, x);
      if (x >= N && y >= M) break outer;
    }
    if (d > 20000) break; // 极端情况保护
  }
  // 回溯
  const ops = [];
  let x = N, y = M;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vv = trace[d];
    const k = x - y;
    let prevK;
    if (k === -d || (k !== d && (vv.get(k - 1) ?? -1) < (vv.get(k + 1) ?? -1))) prevK = k + 1;
    else prevK = k - 1;
    const prevX = vv.get(prevK) ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { ops.push({ t: ' ', s: A[x - 1], a: x, b: y }); x--; y--; }
    if (d === 0) break;
    if (x === prevX) { ops.push({ t: '+', s: B[y - 1], b: y }); y--; }
    else { ops.push({ t: '-', s: A[x - 1], a: x }); x--; }
  }
  while (x > 0 && y > 0) { ops.push({ t: ' ', s: A[x - 1], a: x, b: y }); x--; y--; }
  ops.reverse();
  return ops;
}

/** 生成带 3 行上下文的 hunk 列表 */
export function diffHunks(a, b, context = 3) {
  const ops = diffLines(a, b);
  const changed = ops.map((o, i) => (o.t !== ' ' ? i : -1)).filter((i) => i >= 0);
  if (!changed.length) return { hunks: [], added: 0, removed: 0 };
  const hunks = [];
  let start = Math.max(0, changed[0] - context);
  let end = Math.min(ops.length - 1, changed[0] + context);
  for (const i of changed.slice(1)) {
    if (i - context <= end + 1) end = Math.min(ops.length - 1, i + context);
    else {
      hunks.push(ops.slice(start, end + 1));
      start = Math.max(0, i - context);
      end = Math.min(ops.length - 1, i + context);
    }
  }
  hunks.push(ops.slice(start, end + 1));
  return {
    hunks,
    added: ops.filter((o) => o.t === '+').length,
    removed: ops.filter((o) => o.t === '-').length,
  };
}
