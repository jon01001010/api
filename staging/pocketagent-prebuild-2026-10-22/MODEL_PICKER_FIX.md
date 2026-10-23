# Chat model picker cleanup

The screenshot shows the original combined Assistants / Models bottom sheet.
The patch `patches/apply-model-picker-models-only.py` changes that sheet to
show **only Models**, removes the now-unnecessary tabs, and preserves existing
model selection behavior. Assistants remain available from the separate
Assistants screen in the navigation drawer. No assistant data is deleted.

Apply from repository root after copying the patch:
`python3 patches/apply-model-picker-models-only.py`

Source was checked against `src/components/ChatPalModelPickerSheet/ChatPalModelPickerSheet.tsx`
on branch `pocketagent-step1-integration`. Not built or device-tested.
