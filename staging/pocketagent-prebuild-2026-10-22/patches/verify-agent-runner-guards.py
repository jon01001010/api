#!/usr/bin/env python3
"""Static checks for the staged runner integration. Does not replace Jest/TS."""
from pathlib import Path
s = Path('src/services/agent/AgentRunner.ts').read_text()
checks = {
    'single dispatcher wrapper': s.count('guard.run(fnName, action)') == 1,
    'arguments validated': 'validateToolArguments(call.function?.arguments' in s,
    'validated args dispatched': 'handler.execute(validated.args' in s,
    'per-run budget': 'const guardedExecution = new GuardedToolExecution' in s,
    'cancellation checked': 'if (signal?.aborted)' in s,
    'runner wired': '          guardedExecution,\n        );' in s,
}
for name, passed in checks.items(): print(('PASS' if passed else 'FAIL') + ': ' + name)
if not all(checks.values()): raise SystemExit(1)
