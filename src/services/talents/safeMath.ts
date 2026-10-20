/** Bounded arithmetic grammar. No variables, properties, assignment or dynamic code. */
const functions = new Map<
  string,
  {arity: number; run: (...args: number[]) => number}
>([
  ...(
    [
      'abs',
      'ceil',
      'floor',
      'round',
      'sqrt',
      'sin',
      'cos',
      'tan',
      'asin',
      'acos',
      'atan',
      'log',
      'log10',
      'exp',
    ] as const
  ).map(
    name =>
      [name, {arity: 1, run: Math[name]}] as [
        string,
        {arity: number; run: (...args: number[]) => number},
      ],
  ),
  ['pow', {arity: 2, run: Math.pow}],
  ['min', {arity: 2, run: Math.min}],
  ['max', {arity: 2, run: Math.max}],
]);
export function safeMath(source: string): number {
  if (source.length > 1024) {
    throw new Error('Expression too long');
  }
  const tokens: string[] = [];
  const scanner =
    /\s*(\d+(?:\.\d*)?(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|[a-zA-Z]+|[()+\-*/%^,])\s*/y;
  let offset = 0;
  while (offset < source.length) {
    scanner.lastIndex = offset;
    const match = scanner.exec(source);
    if (!match) {
      throw new Error('Invalid arithmetic character');
    }
    tokens.push(match[1]);
    offset = scanner.lastIndex;
    if (tokens.length > 256) {
      throw new Error('Too many tokens');
    }
  }
  let cursor = 0;
  let depth = 0;
  const take = (token: string) =>
    tokens[cursor] === token ? (++cursor, true) : false;
  const expect = (token: string) => {
    if (!take(token)) {
      throw new Error('Invalid arithmetic syntax');
    }
  };
  function nested<T>(operation: () => T): T {
    if (++depth > 32) {
      throw new Error('Expression too deeply nested');
    }
    try {
      return operation();
    } finally {
      depth--;
    }
  }
  function atom(): number {
    return nested(() => {
      if (take('(')) {
        const value = sum();
        expect(')');
        return value;
      }
      const token = tokens[cursor++];
      if (!token) {
        throw new Error('Missing value');
      }
      if (/^(?:\d|\.)/.test(token)) {
        return Number(token);
      }
      if (token.toLowerCase() === 'pi') {
        return Math.PI;
      }
      if (token.toLowerCase() === 'e') {
        return Math.E;
      }
      const fn = functions.get(token);
      if (!fn) {
        throw new Error('Unknown arithmetic function');
      }
      expect('(');
      const args = [sum()];
      for (let i = 1; i < fn.arity; i++) {
        expect(',');
        args.push(sum());
      }
      expect(')');
      return fn.run(...args);
    });
  }
  function power(): number {
    const value = atom();
    return take('^') ? nested(() => value ** unary()) : value;
  }
  function unary(): number {
    if (take('+')) {
      return nested(unary);
    }
    if (take('-')) {
      return nested(() => -unary());
    }
    return power();
  }
  function product(): number {
    let value = unary();
    while (true) {
      if (take('*')) {
        value *= unary();
      } else if (take('/')) {
        value /= unary();
      } else if (take('%')) {
        value %= unary();
      } else {
        return value;
      }
    }
  }
  function sum(): number {
    let value = product();
    while (true) {
      if (take('+')) {
        value += product();
      } else if (take('-')) {
        value -= product();
      } else {
        return value;
      }
    }
  }
  const result = sum();
  if (cursor !== tokens.length) {
    throw new Error('Unexpected arithmetic token');
  }
  return result;
}
