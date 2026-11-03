# PocketAgent — precise built-in tool instructions

This cumulative staged checkpoint includes the earlier #28 files and a new patch for the five existing built-in tools.

Run from the **root of a complete PocketAgent checkout**:

```bash
python3 patches/apply_precise_tool_docs.py
```

Updates `calculate`, `datetime`, `render_html`, `read_url`, and `web_search` tool definitions with exact parameter guidance, valid examples, prohibited formats, and error recovery. Also improves calculator error feedback. The calculator parser only accepts ASCII operators (`*`, `/`) and a limited grammar; the rewrite does not loosen that parser.

**Not applied to GitHub, not built or tested on Android.** Custom user-defined tools require a separate schema-description pass. The earlier staged changes remain unintegrated.
