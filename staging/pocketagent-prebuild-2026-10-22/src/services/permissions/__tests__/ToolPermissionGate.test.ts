import {ToolPermissionGate} from '../ToolPermissionGate';
import {ToolPermissionPolicy} from '../ToolPermissionPolicy';

describe('ToolPermissionGate', () => {
  it('prompts for sensitive tools and honors allow-once', async () => {
    const ask = jest.fn(async () => 'allow-once' as const);
    const gate = new ToolPermissionGate(new ToolPermissionPolicy(), ask);
    expect(await gate.authorize('send_message')).toBe(true);
    expect(await gate.authorize('send_message')).toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it('remembers always grants and denies prompt failures', async () => {
    const ask = jest.fn(async () => 'allow-always' as const);
    const gate = new ToolPermissionGate(new ToolPermissionPolicy(), ask);
    expect(await gate.authorize('read_file')).toBe(true);
    expect(await gate.authorize('read_file')).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    expect(await new ToolPermissionGate(new ToolPermissionPolicy(), async () => {throw Error('dismissed');}).authorize('read_file')).toBe(false);
  });
  it('does not grant cancelled operations', async () => {
    const controller = new AbortController(); controller.abort();
    const ask = jest.fn(async () => 'allow-always' as const);
    expect(await new ToolPermissionGate(new ToolPermissionPolicy(), ask).authorize('open_app', controller.signal)).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });
  it('does not consume one grant twice during concurrent calls', async () => {
    const policy = new ToolPermissionPolicy();
    policy.grant({tool:'send_message',category:'messages'},'allow-once');
    const ask = jest.fn(async () => 'deny' as const);
    const gate = new ToolPermissionGate(policy,ask);
    expect(await Promise.all([gate.authorize('send_message'),gate.authorize('send_message')])).toEqual([true,false]);
    expect(ask).toHaveBeenCalledTimes(1);
  });
});


it('does not repeatedly prompt after explicit deny in one run', async () => {
  const ask = jest.fn(async () => 'deny' as const);
  const gate = new ToolPermissionGate(new ToolPermissionPolicy(), ask);
  expect(await gate.authorize('send_message')).toBe(false);
  expect(await gate.authorize('send_message')).toBe(false);
  expect(ask).toHaveBeenCalledTimes(1);
});
