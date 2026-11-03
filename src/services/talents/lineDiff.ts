/**
 * Small line diff for file approvals and the file_diff tool.
 *
 * LCS over lines, printed unified-style: "- " removed, "+ " added, "  "
 * unchanged context (CONTEXT lines around each change, "…" between hunks).
 * Very large inputs fall back to a whole-file replacement so the cost stays
 * bounded on a phone.
 */
const CONTEXT = 2;
const MAX_CELLS = 4_000_000;

export const splitLines = (text: string): string[] =>
  text === '' ? [] : text.split(/\r?\n/);

type Op = {kind: ' ' | '-' | '+'; line: string};

function diffOps(a: string[], b: string[]): Op[] {
  // Trim the common prefix/suffix first; most edits are local.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: Op[] = a.slice(0, start).map(line => ({kind: ' ', line}));
  const tail: Op[] = a.slice(endA).map(line => ({kind: ' ', line}));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  let middle: Op[];
  if ((n + 1) * (m + 1) > MAX_CELLS) {
    middle = [
      ...midA.map(line => ({kind: '-' as const, line})),
      ...midB.map(line => ({kind: '+' as const, line})),
    ];
  } else {
    // lcs[i][j] = LCS length of midA[i..] and midB[j..]
    const lcs: Uint32Array[] = Array.from(
      {length: n + 1},
      () => new Uint32Array(m + 1),
    );
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] =
          midA[i] === midB[j]
            ? lcs[i + 1][j + 1] + 1
            : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    middle = [];
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && midA[i] === midB[j]) {
        middle.push({kind: ' ', line: midA[i]});
        i++;
        j++;
      } else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) {
        // Removals before additions, as in a conventional diff.
        middle.push({kind: '-', line: midA[i]});
        i++;
      } else {
        middle.push({kind: '+', line: midB[j]});
        j++;
      }
    }
  }
  return [...head, ...middle, ...tail];
}

/** Unified-style diff text, or "No changes". */
export function diffLines(before: string, after: string): string {
  const ops = diffOps(splitLines(before), splitLines(after));
  const changed = ops.map(op => op.kind !== ' ');
  if (!changed.includes(true)) {
    return 'No changes';
  }
  const keep = ops.map((_, idx) => {
    for (let k = idx - CONTEXT; k <= idx + CONTEXT; k++) {
      if (changed[k]) {
        return true;
      }
    }
    return false;
  });
  const out: string[] = [];
  let skipped = false;
  ops.forEach((op, idx) => {
    if (keep[idx]) {
      if (skipped) {
        out.push('…');
      }
      skipped = false;
      out.push(op.kind + ' ' + op.line);
    } else {
      skipped = true;
    }
  });
  if (skipped) {
    out.push('…');
  }
  const added = ops.filter(o => o.kind === '+').length;
  const removed = ops.filter(o => o.kind === '-').length;
  return `+${added} -${removed} lines\n` + out.join('\n');
}
