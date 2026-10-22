import {PermissionRequests} from '../permissionRequests';

describe('permission requests', () => {
  it('denies without a mounted listener', async () => {
    const p = new PermissionRequests();
    await expect(p.authorize('read_url', 'network', 'fetch')).resolves.toBe(false);
  });
  it('allows once, then asks again', async () => {
    const p = new PermissionRequests();
    let latest: any;
    p.subscribe(v => {latest = v;});
    const first = p.authorize('read_url', 'network', 'fetch');
    p.respond(latest.id, 'allow_once');
    await expect(first).resolves.toBe(true);
    const second = p.authorize('read_url', 'network', 'fetch');
    expect(latest).not.toBeNull();
    p.respond(latest.id, 'deny');
    await expect(second).resolves.toBe(false);
  });
  it('aborts pending permission without execution', async () => {
    const p = new PermissionRequests();
    p.subscribe(() => {});
    const ctrl = new AbortController();
    const waiting = p.authorize('read_url', 'network', 'fetch', ctrl.signal);
    ctrl.abort();
    await expect(waiting).resolves.toBe(false);
  });
});
