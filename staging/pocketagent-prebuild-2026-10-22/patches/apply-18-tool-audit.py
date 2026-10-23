#!/usr/bin/env python3
from pathlib import Path
def update(path, changes):
    p=Path(path);s=p.read_text()
    if all(new in s for old,new in changes): print('Already applied:',path);return
    for old,new in changes:
        if s.count(old)!=1:raise SystemExit('Unexpected source, unchanged: '+path+' '+repr(old[:50]))
        s=s.replace(old,new,1)
    p.write_text(s)
update('src/services/agent/GuardedToolExecution.ts', [
("import {ToolCallJournal} from '../diagnostics/ToolCallJournal';", "import {ToolCallJournal} from '../diagnostics/ToolCallJournal';\nimport {recordToolAudit} from '../diagnostics/ToolAuditStore';"),
("    const id = this.journal.start(name);", "    const id = this.journal.start(name);\n    const startedAt = Date.now();"),
("      this.journal.finish(id, 'success');", "      this.journal.finish(id, 'success');\n      void recordToolAudit({id, tool: name, startedAt, elapsedMs: Date.now() - startedAt, status: 'success'}).catch(() => {});"),
("      this.journal.finish(id, 'error', 'ToolExecutionFailed');", "      this.journal.finish(id, 'error', 'ToolExecutionFailed');\n      void recordToolAudit({id, tool: name, startedAt, elapsedMs: Date.now() - startedAt, status: 'error', errorType: 'ToolExecutionFailed'}).catch(() => {});")
])
update('src/screens/ToolboxScreen.tsx', [
("import {safeMath} from '../services/talents/safeMath';", "import {safeMath} from '../services/talents/safeMath';\nimport {ToolAuditPanel} from '../components/ToolAuditPanel';"),
('        <Text variant="titleLarge">Toolbox</Text>', '        <Text variant="titleLarge">Toolbox</Text>\n        <ToolAuditPanel />')
])
