/**
 * Hermes (React Native's engine) has no `Symbol.asyncIterator`. Libraries
 * name their stream and paging methods after it (the Anthropic SDK does, at
 * load time), and `for await` looks it up, so without it every such loop
 * fails with "Object is not async iterable". Define it before anything
 * else loads. `Symbol.for` gives the same symbol to any other polyfill.
 */
export function ensureAsyncIterator(target: any = Symbol): void {
  if (typeof target.asyncIterator !== 'symbol') {
    Object.defineProperty(target, 'asyncIterator', {
      value: Symbol.for('Symbol.asyncIterator'),
      configurable: true,
      writable: false,
      enumerable: false,
    });
  }
}

ensureAsyncIterator();
