import React, {useCallback, useEffect, useState} from 'react';
import {Modal, ScrollView, StyleSheet, View} from 'react-native';
import {Button, SegmentedButtons, Switch, Text} from 'react-native-paper';

import {modelStore} from '../../store';
import {useTheme} from '../../hooks';
import {
  buildPromptPreview,
  DEFAULT_PROMPT_PARTS,
  PromptPart,
  PromptPartSettings,
  readPromptPartSettings,
  TimeMode,
  writePromptPartSettings,
} from '../../utils/promptParts';
import {
  generatedToolPrompt,
  readGlobalPrompt,
  readGlobalTools,
} from '../../utils/globalToolSettings';
import {
  collectSystemPromptFragments,
  deriveToolSchemas,
} from '../../services/talents';
import {buildMemoryContext} from '../../services/talents/agentMemory';

/**
 * Toolbox → What the model sees: every part the app adds besides your own
 * messages, each with a switch, and the exact text it sends.
 */
export const PromptPartsSection: React.FC = () => {
  const theme = useTheme();
  const [settings, setSettings] =
    useState<PromptPartSettings>(DEFAULT_PROMPT_PARTS);
  const [preview, setPreview] = useState<{
    parts: PromptPart[];
    tools: {name: string; description: string}[];
  } | null>(null);

  useEffect(() => {
    readPromptPartSettings().then(setSettings);
  }, []);

  const change = useCallback(
    (patch: Partial<PromptPartSettings>) => {
      const next = {...settings, ...patch};
      setSettings(next);
      writePromptPartSettings(next).catch(() => {});
    },
    [settings],
  );

  const showPreview = async () => {
    const [names, globalInstructions] = await Promise.all([
      readGlobalTools().catch(() => [] as string[]),
      readGlobalPrompt().catch(() => ''),
    ]);
    let memoryContext = '';
    try {
      memoryContext = await buildMemoryContext();
    } catch {}
    const parts = buildPromptPreview({
      now: new Date(),
      settings,
      modelDefaultPrompt:
        modelStore.activeModel?.chatTemplate?.systemPrompt ?? '',
      toolGuidance: collectSystemPromptFragments(names, {
        now: new Date(),
        maxToolTurns: 5,
      }),
      globalInstructions,
      memoryContext,
      toolLine: generatedToolPrompt(names),
    });
    const tools = deriveToolSchemas(names).map(t => ({
      name: t.function.name,
      description: t.function.description ?? '',
    }));
    setPreview({parts, tools});
  };

  const row = (
    label: string,
    note: string,
    key: Exclude<keyof PromptPartSettings, 'time'>,
  ) => (
    <View style={styles.row} key={key}>
      <View style={styles.rowText}>
        <Text variant="bodyMedium">{label}</Text>
        <Text variant="bodySmall">{note}</Text>
      </View>
      <Switch
        value={settings[key]}
        onValueChange={v => change({[key]: v})}
        testID={`prompt-part-${key}`}
      />
    </View>
  );

  return (
    <View testID="prompt-parts-section">
      <Text variant="titleMedium">What the model sees</Text>
      <Text variant="bodySmall">
        Besides your messages, the app adds these parts to every chat. Each can
        be switched off; nothing else is added.
      </Text>
      <Text variant="bodyMedium" style={styles.label}>
        Date and time
      </Text>
      <SegmentedButtons
        value={settings.time}
        onValueChange={v => change({time: v as TimeMode})}
        buttons={[
          {value: 'off', label: 'Off', testID: 'prompt-time-off'},
          {value: 'date', label: 'Date only', testID: 'prompt-time-date'},
          {
            value: 'datetime',
            label: 'Date and time',
            testID: 'prompt-time-datetime',
          },
        ]}
      />
      <Text variant="bodySmall" style={styles.note}>
        Told once, in the background, in this device's time zone; never added to
        your message. "Date and time" changes every minute, so on a phone long
        chats are re-read from the start each time (slower).
      </Text>
      {row('Memory', 'Your memory notes (Memory above).', 'memory')}
      {row(
        'Tool list',
        'One line naming the tools that are switched on.',
        'toolList',
      )}
      {row(
        'Tool guidance',
        'Advice a tool adds when on (e.g. web search: search first, cite sources).',
        'toolGuidance',
      )}
      {row(
        "Model's built-in prompt",
        'The prompt that comes with the model file (used when no assistant is picked).',
        'modelDefaultPrompt',
      )}
      <Button mode="outlined" onPress={showPreview} testID="prompt-preview">
        Show exactly what the model sees
      </Button>

      <Modal
        visible={!!preview}
        onRequestClose={() => setPreview(null)}
        animationType="slide">
        <View
          style={[styles.modal, {backgroundColor: theme.colors.background}]}
          testID="prompt-preview-modal">
          <View style={styles.header}>
            <Text variant="titleMedium" style={styles.title}>
              What the model sees
            </Text>
            <Button onPress={() => setPreview(null)}>Close</Button>
          </View>
          <ScrollView contentContainerStyle={styles.body}>
            <Text variant="bodySmall">
              Sent before your messages, in this order, for a chat with no
              assistant picked (an assistant's own prompt takes the place of the
              model's built-in one). Long chats may also get a short summary of
              the earlier part.
            </Text>
            {preview?.parts.length ? null : (
              <Text variant="bodyMedium" style={styles.label}>
                Nothing: the model gets only your messages.
              </Text>
            )}
            {preview?.parts.map(part => (
              <View
                key={part.id}
                style={styles.part}
                testID={`prompt-part-view-${part.id}`}>
                <Text variant="labelLarge">{part.label}</Text>
                <Text variant="bodySmall" style={styles.source}>
                  {part.source}
                </Text>
                <Text variant="bodySmall" selectable>
                  {part.text}
                </Text>
              </View>
            ))}
            {preview?.tools.length ? (
              <View style={styles.part}>
                <Text variant="labelLarge">
                  Tools (sent as tools, with these descriptions)
                </Text>
                <Text variant="bodySmall" style={styles.source}>
                  Toolbox tool switches
                </Text>
                {preview.tools.map(t => (
                  <Text
                    key={t.name}
                    variant="bodySmall"
                    selectable
                    style={styles.tool}>
                    {t.name}: {t.description}
                  </Text>
                ))}
              </View>
            ) : null}
            <View style={styles.part}>
              <Text variant="labelLarge">Your messages</Text>
              <Text variant="bodySmall">
                Sent exactly as you typed them (nothing is added to them).
              </Text>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', marginVertical: 6},
  rowText: {flex: 1, paddingRight: 12},
  label: {marginTop: 12, marginBottom: 6},
  note: {marginTop: 6, marginBottom: 6},
  modal: {flex: 1, paddingTop: 12},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16},
  title: {flex: 1},
  body: {padding: 16},
  part: {marginTop: 16},
  source: {opacity: 0.7, marginBottom: 4},
  tool: {marginTop: 4},
});
