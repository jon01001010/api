import {toolboxPermissionRows} from '../ToolboxPermissionViewModel';
it('distinguishes tool availability from permission grants', () => {
  const rows = toolboxPermissionRows([{name:'send_message',description:'Send'}, {name:'calculate',description:'Math'}]);
  expect(rows[0]).toMatchObject({category:'messages',needsApproval:true});
  expect(rows[1]).toMatchObject({category:'local',needsApproval:false});
});
