from pathlib import Path
p=Path('src/screens/ToolboxScreen.tsx')
s=p.read_text()
needle='    setDrafts(previous => [...previous.filter(t => t.id !== editing.id), editing]);'
assert needle in s
if 'Describe exactly what the tool does' not in s:
    s=s.replace(needle, """    if (!editing.description.trim()) {
      setError('Describe exactly what the tool does and when the model should use it.');
      return;
    }
    const docSchema = JSON.parse(editing.parameters) as {properties?: Record<string, {type?: string; description?: string}>; required?: string[]};
    if (!docSchema.properties || typeof docSchema.properties !== 'object' || Array.isArray(docSchema.properties)) {
      setError('Define parameter properties with types and descriptions.');
      return;
    }
    for (const [key, spec] of Object.entries(docSchema.properties)) {
      if (!spec || !['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(spec.type ?? '') || !spec.description?.trim()) {
        setError(`Parameter ${key}: supply a valid type and precise description.`);
        return;
      }
    }
    if (docSchema.required && (!Array.isArray(docSchema.required) || docSchema.required.some(key => !Object.prototype.hasOwnProperty.call(docSchema.properties, key)))) {
      setError('Required parameter names must exist in properties.');
      return;
    }
"""+needle)
needle2='              <Text variant="bodyMedium">{draft.description}</Text>'
assert needle2 in s
if 'Parameter guide (draft only)' not in s:
    s=s.replace(needle2,needle2+"""
              <Text variant="titleSmall">Parameter guide (draft only)</Text>
              <Text variant="bodySmall" selectable>{(() => {
                try {
                  const schema = JSON.parse(draft.parameters) as {properties?: Record<string, {type?: string; description?: string}>; required?: string[]};
                  return Object.entries(schema.properties ?? {}).map(([key, spec]) =>
                    `${key} (${spec.type ?? 'unknown'}, ${schema.required?.includes(key) ? 'required' : 'optional'}): ${spec.description ?? 'Missing description'}`
                  ).join('\n') || 'No arguments';
                } catch { return 'Invalid parameter schema'; }
              })()}</Text>
              <Text variant="bodySmall">Custom tools are drafts only; not available to the agent.</Text>""")
needle3='              <TextInput label="Parameters (JSON schema)"'
assert needle3 in s
if 'Describe accepted formats' not in s:
    s=s.replace(needle3,"""              <Text variant="bodySmall">Describe accepted formats, characters, valid values, and an example for every parameter. Use exact argument names. Describe error recovery in the tool description.</Text>
"""+needle3)
p.write_text(s)
print('Updated',p)
