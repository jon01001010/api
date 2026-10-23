#!/usr/bin/env python3
"""Apply the PocketAgent execution guards to AgentRunner.ts; atomic and idempotent.
Run at repository root after copying staged src/ files.
"""
from pathlib import Path
p = Path('src/services/agent/AgentRunner.ts')
s = p.read_text()
if 'const guardedExecution = new GuardedToolExecution' in s:
    print('Already applied'); raise SystemExit(0)

def once(old, new):
    global s
    if s.count(old) != 1:
        raise SystemExit(f'Unexpected upstream source: {old[:90]!r}; no file written')
    s = s.replace(old, new, 1)

once("import type {TalentResult} from '../talents/types';", "import type {TalentResult} from '../talents/types';\nimport {ExecutionBudget} from './ExecutionBudget';\nimport {GuardedToolExecution} from './GuardedToolExecution';\nimport {ToolCallJournal} from '../diagnostics/ToolCallJournal';\nimport {validateToolArguments} from './ToolArgumentValidator';")
once('  signal?: AbortSignal,\n): Promise<AgentToolOutcome> {', '  signal?: AbortSignal,\n  guard?: GuardedToolExecution,\n): Promise<AgentToolOutcome> {')
once("  let parsedArgs: Record<string, unknown> = {};\n  try {\n    parsedArgs = JSON.parse(call.function?.arguments || '{}');\n  } catch {\n    const summary = `Error: invalid JSON arguments for ${fnName}`;", "  const validated = validateToolArguments(call.function?.arguments || '{}');\n  if (!validated.ok) {\n    const summary = `Error: invalid or unsafe arguments for ${fnName}`;")
once("    return {callId, toolName: fnName, result, responseContent: summary};\n  }\n\n  try {\n    const toolResult = await (signal\n      ? handler.execute(parsedArgs, {signal})\n      : handler.execute(parsedArgs));", "    return {callId, toolName: fnName, result, responseContent: summary};\n  }\n\n  if (signal?.aborted) {\n    const summary = `Tool ${fnName} cancelled`;\n    const result: TalentResult = {type: 'error', summary, errorMessage: summary};\n    return {callId, toolName: fnName, result, responseContent: summary};\n  }\n\n  try {\n    const action = () => signal\n      ? handler.execute(validated.args, {signal})\n      : handler.execute(validated.args);\n    const toolResult = guard ? await guard.run(fnName, action) : await action();")
once("  yield {type: 'run_started', messageId};", "  // A fresh budget and bounded, private journal for each agent run.\n  const guardedExecution = new GuardedToolExecution(\n    new ExecutionBudget(Math.max(1, Math.min(1000, maxTurns * 8)), 10 * 60 * 1000),\n    new ToolCallJournal(100),\n  );\n  yield {type: 'run_started', messageId};")
once("          talentLookup,\n          signal,\n        );", "          talentLookup,\n          signal,\n          guardedExecution,\n        );")
p.write_text(s)
print('Patched AgentRunner: action budget, privacy journal, argument validation, abort check')
