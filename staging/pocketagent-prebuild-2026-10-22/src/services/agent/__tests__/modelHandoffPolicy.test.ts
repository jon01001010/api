import {decideModelHandoff} from '../modelHandoffPolicy';
describe('model handoff security', () => {
  const base = {current: 'local' as const, target: 'claude' as const, reason: 'timeout' as const,
    userApprovedRemote: false, remoteConfigured: true, containsPrivateFiles: false,
    fileSharingApproved: false, activeToolCall: false};
  it('requires explicit consent', () => expect(decideModelHandoff(base).allowed).toBe(false));
  it('requires separate file approval', () => expect(decideModelHandoff({...base,userApprovedRemote:true,containsPrivateFiles:true}).allowed).toBe(false));
  it('permits approved transfer', () => expect(decideModelHandoff({...base,userApprovedRemote:true}).allowed).toBe(true));
  it('blocks mid-tool transfer', () => expect(decideModelHandoff({...base,userApprovedRemote:true,activeToolCall:true}).allowed).toBe(false));
  it('allows returning to local without remote consent', () => expect(decideModelHandoff({...base,current:'claude',target:'local'}).allowed).toBe(true));
});
