import {classifyTool} from '../ToolPermissionCatalog';
import {ToolPermissionGate} from '../ToolPermissionGate';
import {ToolPermissionPolicy} from '../ToolPermissionPolicy';
import {toolboxPermissionRows} from '../ToolboxPermissionViewModel';

describe('per-tool permissions', () => {
  it.each(['calculate', 'datetime', 'render_html'])('permits known local-only %s without prompt', async tool => {
    const ask = jest.fn(async () => 'deny' as const);
    expect(await new ToolPermissionGate(new ToolPermissionPolicy(), ask).authorize(tool)).toBe(true);
    expect(ask).not.toHaveBeenCalled();
  });
  it('blocks unknown tools even if the model names them', async () => {
    const ask = jest.fn(async () => 'allow-always' as const);
    expect(classifyTool('unregistered_tool').kind).toBe('unknown');
    expect(await new ToolPermissionGate(new ToolPermissionPolicy(), ask).authorize('unregistered_tool')).toBe(false);
    expect(ask).not.toHaveBeenCalled();
  });
  it('does not transfer an allow-always grant to another tool in same category', async () => {
    const ask = jest.fn(async () => 'allow-always' as const);
    const gate = new ToolPermissionGate(new ToolPermissionPolicy(), ask);
    expect(await gate.authorize('read_url')).toBe(true);
    expect(await gate.authorize('web_search')).toBe(true);
    expect(ask).toHaveBeenCalledTimes(2);
  });
  it('marks unknown tools blocked in Toolbox metadata', () => {
    const rows = toolboxPermissionRows([{name:'calculate',description:''},{name:'read_url',description:''},{name:'unregistered_tool',description:''}]);
    expect(rows.map(r => [r.category,r.needsApproval,r.blocked])).toEqual([
      ['local',false,false], ['network',true,false], ['unknown',false,true],
    ]);
  });
});
