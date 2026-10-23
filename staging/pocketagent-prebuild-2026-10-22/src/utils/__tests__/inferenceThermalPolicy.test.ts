import {decideThermalAction, shouldUnloadModel} from '../inferenceThermalPolicy';
describe('thermal guidance', () => {
  it('never assumes temperature without telemetry', () => expect(decideThermalAction('unknown', 8).action).toBe('normal'));
  it('reduces suggested threads safely', () => expect(decideThermalAction('fair', 8).suggestedThreads).toBe(6));
  it('blocks new work in critical state', () => expect(decideThermalAction('critical', 8).action).toBe('stop_new_work'));
  it('does not unload just for switching apps', () => expect(shouldUnloadModel('app_background')).toBe(false));
  it('allows explicit unload', () => expect(shouldUnloadModel('user_unload')).toBe(true));
});
