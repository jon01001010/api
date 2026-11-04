/**
 * A `fetch` for the Anthropic SDK that can stream. React Native's own fetch
 * gives no response body stream, so this one uses XMLHttpRequest (the same
 * way the app streams OpenAI-compatible servers): the response resolves as
 * soon as headers arrive, and its `body` is an async iterable of byte chunks
 * fed by XHR progress events. The SDK reads stream bodies through
 * `Symbol.asyncIterator`, so no ReadableStream polyfill is needed.
 */
import {utf8Encode} from './utf8';

type FetchInit = {
  method?: string;
  headers?: any;
  body?: any;
  signal?: AbortSignal | null;
};

function headerEntries(headers: any): [string, string][] {
  if (!headers) {
    return [];
  }
  if (typeof headers.forEach === 'function' && !Array.isArray(headers)) {
    const out: [string, string][] = [];
    headers.forEach((value: string, key: string) => out.push([key, value]));
    return out;
  }
  if (Array.isArray(headers)) {
    return headers as [string, string][];
  }
  return Object.entries(headers).filter(
    ([, v]) => v !== undefined && v !== null,
  ) as [string, string][];
}

function parseResponseHeaders(raw: string): Headers {
  const headers = new Headers();
  for (const line of raw.trim().split(/[\r\n]+/)) {
    const at = line.indexOf(':');
    if (at > 0) {
      headers.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
    }
  }
  return headers;
}

const abortError = () => {
  const error = new Error('Request was aborted.');
  error.name = 'AbortError';
  return error;
};

export function xhrFetch(input: any, init: FetchInit = {}): Promise<any> {
  const url = typeof input === 'string' ? input : String(input?.url ?? input);
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const signal = init.signal ?? undefined;
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    // Body chunks waiting to be read, and a reader waiting for one.
    const queue: Uint8Array[] = [];
    let waiting: ((r: IteratorResult<Uint8Array>) => void) | null = null;
    let failWaiting: ((e: Error) => void) | null = null;
    let done = false;
    let failure: Error | null = null;
    let seen = 0;
    let resolved = false;

    const push = (chunk: Uint8Array) => {
      if (waiting) {
        const w = waiting;
        waiting = failWaiting = null;
        w({value: chunk, done: false});
      } else {
        queue.push(chunk);
      }
    };
    const end = (error?: Error) => {
      if (done) {
        return;
      }
      done = true;
      failure = error ?? null;
      if (waiting) {
        const w = waiting;
        const f = failWaiting;
        waiting = failWaiting = null;
        if (error) {
          f?.(error);
        } else {
          w({value: undefined as any, done: true});
        }
      }
    };
    // `final` flushes everything; otherwise a trailing half of an emoji
    // (a lone high surrogate) waits for the next progress event.
    const takeNewText = (final = false) => {
      const text = xhr.responseText ?? '';
      let upTo = text.length;
      if (!final && upTo > seen) {
        const last = text.charCodeAt(upTo - 1);
        if (last >= 0xd800 && last <= 0xdbff) {
          upTo -= 1;
        }
      }
      if (upTo > seen) {
        const chunk = text.slice(seen, upTo);
        seen = upTo;
        push(utf8Encode(chunk));
      }
    };

    const onAbort = () => xhr.abort();
    signal?.addEventListener('abort', onAbort);

    const iterator: AsyncIterator<Uint8Array> = {
      next: () => {
        if (queue.length) {
          return Promise.resolve({value: queue.shift()!, done: false});
        }
        if (done) {
          return failure
            ? Promise.reject(failure)
            : Promise.resolve({value: undefined as any, done: true});
        }
        return new Promise((res, rej) => {
          waiting = res;
          failWaiting = rej;
        });
      },
      return: () => {
        if (!done) {
          xhr.abort();
        }
        end();
        return Promise.resolve({value: undefined as any, done: true});
      },
    };
    const body = {[Symbol.asyncIterator]: () => iterator};

    const whole = new Promise<string>((res, rej) => {
      xhr.addEventListener('load', () => res(xhr.responseText ?? ''));
      xhr.addEventListener('error', () =>
        rej(new TypeError('Network request failed')),
      );
      xhr.addEventListener('abort', () => rej(abortError()));
    });
    whole.catch(() => {});

    const respond = () => {
      if (resolved) {
        return;
      }
      resolved = true;
      const status = xhr.status;
      resolve({
        ok: status >= 200 && status < 300,
        status,
        statusText: xhr.statusText ?? '',
        url,
        redirected: false,
        type: 'basic',
        headers: parseResponseHeaders(xhr.getAllResponseHeaders() ?? ''),
        body,
        bodyUsed: false,
        text: () => whole,
        json: () => whole.then(t => JSON.parse(t)),
      });
    };

    xhr.open(init.method ?? 'GET', url);
    for (const [key, value] of headerEntries(init.headers)) {
      xhr.setRequestHeader(key, String(value));
    }
    xhr.onreadystatechange = () => {
      if (xhr.readyState >= 2) {
        respond();
      }
    };
    xhr.onprogress = () => {
      respond();
      takeNewText();
    };
    xhr.onload = () => {
      respond();
      takeNewText(true);
      signal?.removeEventListener('abort', onAbort);
      end();
    };
    xhr.onerror = () => {
      signal?.removeEventListener('abort', onAbort);
      const error = new TypeError('Network request failed');
      if (!resolved) {
        resolved = true;
        reject(error);
      }
      end(error);
    };
    xhr.onabort = () => {
      signal?.removeEventListener('abort', onAbort);
      if (!resolved) {
        resolved = true;
        reject(abortError());
      }
      end(abortError());
    };
    xhr.send(init.body ?? null);
  });
}
