#!/usr/bin/env python3
"""Keep foreground service alive for the entire lease, not just UI lifetime."""
from pathlib import Path
p=Path('src/hooks/useChatSession.ts')
s=p.read_text()
marker='// #20: foreground-service lifecycle is bound to the generation lease'
if marker in s:
    print('Already applied');raise SystemExit(0)
old="""    // Run UI clears on abort, not on drain.
    let uiStopped = false;
    let completedNormally = false;
    const uiStop = () => {"""
new="""    // Run UI clears on abort, not on drain.
    let uiStopped = false;
    let completedNormally = false;
    // #20: foreground-service lifecycle is bound to the generation lease,
    // not the chat screen's visible/hidden state.
    const uiStop = () => {"""
old_finish="""      try {
        deactivateKeepAwake();
        void finishBackgroundInference(completedNormally && !lease.signal.aborted).catch(error => console.warn('Could not stop inference notification', error));
      } catch (error) {
        console.error('Failed to deactivate keep awake after chat:', error);
      }"""
new_finish="""      try {
        deactivateKeepAwake();
      } catch (error) {
        console.error('Failed to deactivate keep awake after chat:', error);
      }"""
old_final="""    } finally {
      cancelSubscription?.remove();
      lease.signal.removeEventListener('abort', uiStop);
      uiStop();
      if (leaseRef.current === lease) {"""
new_final="""    } finally {
      // Even when the app is backgrounded, the generation lease owns the
      // foreground service until the runner has actually settled.
      await finishBackgroundInference(completedNormally && !lease.signal.aborted)
        .catch(error => console.warn('Could not stop inference notification', error));
      cancelSubscription?.remove();
      lease.signal.removeEventListener('abort', uiStop);
      uiStop();
      if (leaseRef.current === lease) {"""
for a,b in [(old,new),(old_finish,new_finish),(old_final,new_final)]:
    if s.count(a)!=1:raise SystemExit('Source anchor mismatch; no changes: '+repr(a[:75]))
    s=s.replace(a,b,1)
p.write_text(s)
print('Patched background continuation lifecycle in',p)
