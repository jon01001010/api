import {permissionForTool} from '../ToolPermissionCatalog';
it('maps known sensitive tools', () => expect(permissionForTool('send_message')).toEqual({tool:'send_message',category:'messages'}));
it('does not infer permission for unknown tools', () => expect(permissionForTool('mystery_tool')).toBeNull());
