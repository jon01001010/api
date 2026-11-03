import {ToolPermissionPolicy} from '../ToolPermissionPolicy';
const file = {tool: 'create_file', category: 'files' as const};
const msg = {tool: 'send_message', category: 'messages' as const};
describe('ToolPermissionPolicy', () => {
  it('denies all tools by default', () => {const p = new ToolPermissionPolicy(); expect(p.consume(file)).toBe(false); expect(p.consume(msg)).toBe(false);});
  it('consumes one-time permission exactly once', () => {const p = new ToolPermissionPolicy(); p.grant(file,'allow-once'); expect(p.consume(file)).toBe(true); expect(p.consume(file)).toBe(false);});
  it('keeps always grants scoped to tool and category', () => {const p = new ToolPermissionPolicy(); p.grant(file,'allow-always'); expect(p.consume(file)).toBe(true); expect(p.consume(file)).toBe(true); expect(p.consume(msg)).toBe(false);});
  it('revokes and denies previous grants', () => {const p = new ToolPermissionPolicy(); p.grant(file,'allow-always'); p.grant(file,'deny'); expect(p.consume(file)).toBe(false);});
  it('reset clears grants', () => {const p = new ToolPermissionPolicy(); p.grant(file,'allow-always'); p.reset(); expect(p.consume(file)).toBe(false);});
});


describe('complete decision lifecycle (#15)', () => {
  const request = {tool:'send_message',category:'messages' as const};
  it('allow once is consumed exactly once', () => {
    const p = new ToolPermissionPolicy(); p.grant(request,'allow-once');
    expect(p.consume(request)).toBe(true); expect(p.consume(request)).toBe(false);
  });
  it('always remains allowed until reset or revocation', () => {
    const p = new ToolPermissionPolicy(); p.grant(request,'allow-always');
    expect(p.consume(request)).toBe(true); expect(p.consume(request)).toBe(true);
    p.revoke(request); expect(p.consume(request)).toBe(false);
  });
  it('deny overrides earlier grants and stays denied for the run', () => {
    const p = new ToolPermissionPolicy(); p.grant(request,'allow-always'); p.grant(request,'deny');
    expect(p.consume(request)).toBe(false); expect(p.isDenied(request)).toBe(true);
    p.reset(); expect(p.isDenied(request)).toBe(false);
  });
});
