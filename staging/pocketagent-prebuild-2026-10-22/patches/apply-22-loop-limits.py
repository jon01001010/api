#!/usr/bin/env python3
"""Harden existing Toolbox loop slider and runner limit; atomic preflight."""
from pathlib import Path
screen=Path('src/screens/ToolboxScreen.tsx')
runner=Path('src/services/agent/AgentRunner.ts')
s=screen.read_text(); r=runner.read_text()
marker='// #22: save the loop limit with rollback'
if marker in s: print('Already applied'); raise SystemExit(0)
old="""          onValueChange={setAgentMaxTurns}
          onSlidingComplete={value => writeAgentMaxTurns(value).catch(e => setToggleError(String(e)))} />"""
new="""          onValueChange={setAgentMaxTurns}
          // #22: save the loop limit with rollback
          onSlidingComplete={async value => {
            const next = Math.max(5, Math.min(500, Math.round(value / 5) * 5));
            try {
              await writeAgentMaxTurns(next);
              setAgentMaxTurns(next);
              setToggleError('');
            } catch (e) {
              setToggleError('Could not save loop limit: ' + String(e));
              try {setAgentMaxTurns(await readAgentMaxTurns());} catch {}
            }
          }} />"""
# Guard budget must match the configured maximum rather than maxTurns * 8.
budget='new ExecutionBudget(Math.max(1, Math.min(1000, maxTurns * 8)), 10 * 60 * 1000)'
revised='new ExecutionBudget(Math.max(1, Math.min(500, maxTurns)), 10 * 60 * 1000)'
if s.count(old)!=1 or r.count(budget)!=1: raise SystemExit('Unexpected source; no files modified')
screen.write_text(s.replace(old,new,1))
runner.write_text(r.replace(budget,revised,1))
print('Loop slider rollback and strict tool-action cap applied')
