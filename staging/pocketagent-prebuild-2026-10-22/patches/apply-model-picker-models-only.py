#!/usr/bin/env python3
"""Remove legacy assistant tab from chat's model picker; retain separate Assistants screen."""
from pathlib import Path
p=Path('src/components/ChatPalModelPickerSheet/ChatPalModelPickerSheet.tsx')
s=p.read_text()
if '// PocketAgent: model picker is models-only' in s:
    print('Already applied'); raise SystemExit(0)
old="""    const TABS = React.useMemo(
      () => [
        {
          id: 'pals' as Tab,
          label: l10n.components.chatPalModelPickerSheet.palsTab,
        },
        {
          id: 'models' as Tab,
          label: l10n.components.chatPalModelPickerSheet.modelsTab,
        },
      ],
      [
        l10n.components.chatPalModelPickerSheet.palsTab,
        l10n.components.chatPalModelPickerSheet.modelsTab,
      ],
    );"""
new="""    // PocketAgent: model picker is models-only; assistants live in their own screen.
    const TABS = React.useMemo(
      () => [{id: 'models' as Tab, label: l10n.components.chatPalModelPickerSheet.modelsTab}],
      [l10n.components.chatPalModelPickerSheet.modelsTab],
    );"""
if s.count(old)!=1: raise SystemExit('Picker source differs; refusing to patch')
s=s.replace(old,new)
# Keep model list and selection intact; hide redundant one-tab header.
old2="""        <View style={styles.tabs}>
          {TABS.map((tab, index) => renderTab(tab.id, tab.label, index))}
        </View>"""
if s.count(old2)!=1: raise SystemExit('Picker header differs; refusing to patch')
s=s.replace(old2,'')
p.write_text(s)
print('Models-only picker applied')
