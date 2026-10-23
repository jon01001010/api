#!/usr/bin/env python3
from pathlib import Path
runner=Path('src/services/agent/AgentRunner.ts')
types=Path('src/services/agent/AgentRunner.types.ts')
hook=Path('src/hooks/useChatSession.ts')
r=runner.read_text(); t=types.read_text(); h=hook.read_text()
if "// #24 cooperative pause" in r:
    print('Already applied');raise SystemExit(0)
changes_r=[
 ("import {stopQuietly} from '../../utils/stopQuietly';", "import {stopQuietly} from '../../utils/stopQuietly';\nimport {AgentPauseController} from './AgentPauseController';"),
 ("    signal,\n  } = options;", "    signal,\n    pauseController,\n  } = options;"),
 ("      const isForcedFinal = forceFinal;", "      // #24 cooperative pause: never suspend an in-flight native completion.\n      await pauseController?.wait(signal);\n      const isForcedFinal = forceFinal;"),
 ("      for (const call of calls) {\n        yield {type: 'tool_call_started', call};", "      for (const call of calls) {\n        await pauseController?.wait(signal);\n        if (signal?.aborted) break;\n        yield {type: 'tool_call_started', call};"),
]
changes_t=[("  signal?: AbortSignal;\n}","  signal?: AbortSignal;\n  pauseController?: import('./AgentPauseController').AgentPauseController;\n}")]
# Only add controller wiring to the hook; UI can use exported controls via a separate toolbar integration.
changes_h=[
 ("import type {GenerationLease} from '../store/generationLease';", "import type {GenerationLease} from '../store/generationLease';\nimport {AgentPauseController} from '../services/agent/AgentPauseController';"),
 ("    leaseRef.current = lease;", "    leaseRef.current = lease;\n    const pauseController = new AgentPauseController();\n    activeAgentPauseController = pauseController;"),
 ("      if (leaseRef.current === lease) {", "      if (activeAgentPauseController === pauseController) activeAgentPauseController = null;\n      if (leaseRef.current === lease) {"),
]
# controller instance must live outside hook scope to expose safe toolbar controls
changes_h.append(("import React, {useRef} from 'react';", "import React, {useRef} from 'react';\nlet activeAgentPauseController: AgentPauseController | null = null;\nexport const pauseActiveAgent = () => activeAgentPauseController?.pause();\nexport const resumeActiveAgent = () => activeAgentPauseController?.resume();\nexport const isAgentPaused = () => activeAgentPauseController?.isPaused ?? false;"))
# Wiring runner options depends on exact runAgent call; add it only if one occurrence
anchor='      signal: lease.signal,'
if h.count(anchor)==1:
    changes_h.append((anchor,anchor+'\n      pauseController,'))
else:
    raise SystemExit('Runner signal anchor not unique; refusing partial patch')
for text,changes in [(r,changes_r),(t,changes_t),(h,changes_h)]:
    for old,new in changes:
        old=old.replace('\\n','\n');new=new.replace('\\n','\n')
        if text.count(old)!=1:raise SystemExit('Source anchor mismatch: '+repr(old[:90]))
        text=text.replace(old,new,1)
    if changes is changes_r:r=text
    elif changes is changes_t:t=text
    else:h=text
runner.write_text(r);types.write_text(t);hook.write_text(h)
print('Pause boundaries and hook controls integrated')
