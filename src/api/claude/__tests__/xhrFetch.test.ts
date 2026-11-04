import {xhrFetch} from '../xhrFetch';
import {utf8Decode} from '../utf8';

/** A controllable XMLHttpRequest: tests drive headers, progress, load. */
class FakeXHR {
  static last: FakeXHR;
  readyState = 0;
  status = 0;
  statusText = '';
  responseText = '';
  method = '';
  url = '';
  sent: any;
  headers: Record<string, string> = {};
  listeners: Record<string, Array<() => void>> = {};
  onreadystatechange?: () => void;
  onprogress?: () => void;
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  constructor() {
    FakeXHR.last = this;
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  addEventListener(name: string, fn: () => void) {
    (this.listeners[name] ??= []).push(fn);
  }
  getAllResponseHeaders() {
    return 'content-type: text/event-stream\r\nrequest-id: req_1\r\n';
  }
  send(body: any) {
    this.sent = body;
  }
  abort() {
    this.onabort?.();
    this.listeners.abort?.forEach(f => f());
  }
  // test helpers
  headersArrive(status = 200) {
    this.status = status;
    this.readyState = 2;
    this.onreadystatechange?.();
  }
  receive(text: string) {
    this.responseText += text;
    this.readyState = 3;
    this.onprogress?.();
  }
  finish() {
    this.readyState = 4;
    this.onload?.();
    this.listeners.load?.forEach(f => f());
  }
}

describe('xhrFetch', () => {
  const realXHR = (globalThis as any).XMLHttpRequest;
  beforeEach(() => {
    (globalThis as any).XMLHttpRequest = FakeXHR;
  });
  afterAll(() => {
    (globalThis as any).XMLHttpRequest = realXHR;
  });

  it('sends the request and resolves as soon as headers arrive', async () => {
    const pending = xhrFetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: new Headers({
        'x-api-key': 'k',
        'content-type': 'application/json',
      }),
      body: '{"a":1}',
    });
    const xhr = FakeXHR.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.headers['x-api-key']).toBe('k');
    expect(xhr.sent).toBe('{"a":1}');
    xhr.headersArrive(200);
    const res = await pending;
    expect(res.ok).toBe(true);
    expect(res.headers.get('request-id')).toBe('req_1');
  });

  it('streams the body in chunks as they arrive', async () => {
    const pending = xhrFetch('https://x.test', {headers: {a: 'b'}});
    const xhr = FakeXHR.last;
    xhr.headersArrive();
    const res = await pending;
    const it = res.body[Symbol.asyncIterator]();
    xhr.receive('event: a\n');
    expect(utf8Decode((await it.next()).value)).toBe('event: a\n');
    const next = it.next();
    xhr.receive('data: {"x":"🐱"}\n\n');
    expect(utf8Decode((await next).value)).toBe('data: {"x":"🐱"}\n\n');
    xhr.finish();
    expect((await it.next()).done).toBe(true);
  });

  it('holds back half an emoji until the rest arrives', async () => {
    const pending = xhrFetch('https://x.test');
    const xhr = FakeXHR.last;
    xhr.headersArrive();
    const res = await pending;
    const it = res.body[Symbol.asyncIterator]();
    const cat = '🐱';
    xhr.receive('a' + cat[0]);
    expect(utf8Decode((await it.next()).value)).toBe('a');
    xhr.receive(cat[1]);
    expect(utf8Decode((await it.next()).value)).toBe(cat);
  });

  it('gives the whole body for text() and json()', async () => {
    const pending = xhrFetch('https://x.test');
    const xhr = FakeXHR.last;
    xhr.headersArrive(401);
    const res = await pending;
    expect(res.ok).toBe(false);
    const body = res.json();
    xhr.receive('{"error":{"message":"bad key"}}');
    xhr.finish();
    expect(await body).toEqual({error: {message: 'bad key'}});
  });

  it('aborts through the signal', async () => {
    const controller = new AbortController();
    const pending = xhrFetch('https://x.test', {signal: controller.signal});
    const xhr = FakeXHR.last;
    xhr.headersArrive();
    const res = await pending;
    const it = res.body[Symbol.asyncIterator]();
    const next = it.next();
    controller.abort();
    await expect(next).rejects.toThrow('aborted');
  });

  it('rejects on a network error before headers', async () => {
    const pending = xhrFetch('https://x.test');
    FakeXHR.last.onerror?.();
    await expect(pending).rejects.toThrow('Network request failed');
  });
});
