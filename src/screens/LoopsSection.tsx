/**
 * Toolbox → Loops: the ready-made loops gallery and the running loops
 * (src/services/loops). Pick one, fill in the blanks, choose how often,
 * press Start. Nothing runs without a tap: when one is due the app asks.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, View} from 'react-native';
import {Button, Card, Chip, Text, TextInput} from 'react-native-paper';

import {
  LOOP_TEMPLATES,
  type LoopTemplate,
} from '../services/loops/loopTemplates';
import {
  EVERY_LABEL,
  type Every,
  isFinished,
  loadLoops,
  type Loop,
  MAX_DAYS,
  MAX_RUNS,
  startLoop,
  stopLoop,
  summary,
  updateLoop,
  addLog,
} from '../services/loops/loops';
import {runLoopNow} from '../services/loops/loopRunner';

const EVERY: Every[] = ['hour', '3hours', 'day', 'week'];

const parseTime = (text: string) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) {
    return undefined;
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? {hour, minute} : undefined;
};

const timeText = (at?: {hour: number; minute: number}) =>
  at
    ? `${String(at.hour).padStart(2, '0')}:${String(at.minute).padStart(2, '0')}`
    : '';

const Setup: React.FC<{
  template: LoopTemplate;
  onDone: () => void;
}> = ({template, onDone}) => {
  const [values, setValues] = useState<Record<string, string>>({});
  const [every, setEvery] = useState<Every>(template.every);
  const [time, setTime] = useState(timeText(template.at));
  const [runs, setRuns] = useState(String(template.maxRuns));
  const [days, setDays] = useState(String(template.days));
  const [error, setError] = useState('');
  const timed = every === 'day' || every === 'week';

  const start = async () => {
    const at = timed ? parseTime(time) : undefined;
    if (timed && !at) {
      setError('Time as HH:MM, e.g. 07:30');
      return;
    }
    const r = await startLoop({
      templateId: template.id,
      values,
      every,
      at,
      maxRuns: Number(runs) || template.maxRuns,
      days: Number(days) || template.days,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    Alert.alert(`Started: ${template.title}`, summary(r.loop));
    onDone();
  };

  return (
    <Card mode="outlined" testID={`loop-setup-${template.id}`}>
      <Card.Title title={template.title} subtitle={template.oneLine} />
      <Card.Content style={{gap: 8}}>
        {template.blanks.map(b => (
          <TextInput
            key={b.key}
            mode="outlined"
            dense
            label={b.label}
            placeholder={b.example}
            value={values[b.key] ?? ''}
            onChangeText={v => setValues({...values, [b.key]: v})}
            testID={`loop-blank-${b.key}`}
          />
        ))}
        <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
          {EVERY.map(e => (
            <Chip key={e} selected={every === e} onPress={() => setEvery(e)}>
              {EVERY_LABEL[e]}
            </Chip>
          ))}
        </View>
        {timed ? (
          <TextInput
            mode="outlined"
            dense
            label="At (HH:MM)"
            value={time}
            onChangeText={setTime}
          />
        ) : null}
        <View style={{flexDirection: 'row', gap: 8}}>
          <TextInput
            style={{flex: 1}}
            mode="outlined"
            dense
            keyboardType="number-pad"
            label={`Runs (max ${MAX_RUNS})`}
            value={runs}
            onChangeText={setRuns}
          />
          <TextInput
            style={{flex: 1}}
            mode="outlined"
            dense
            keyboardType="number-pad"
            label={`Days (max ${MAX_DAYS})`}
            value={days}
            onChangeText={setDays}
          />
        </View>
        <Text variant="bodySmall">May use: {template.uses}</Text>
        <Text variant="bodySmall">
          Asks before each run, then runs in its own chat. Never sends, buys or
          deletes anything by itself; anything outside the app still asks.
        </Text>
        {error ? <Text variant="bodySmall">{error}</Text> : null}
      </Card.Content>
      <Card.Actions>
        <Button onPress={onDone}>Cancel</Button>
        <Button mode="contained" onPress={start} testID="loop-start">
          Start
        </Button>
      </Card.Actions>
    </Card>
  );
};

export const LoopsSection: React.FC<{onOpenChat?: () => void}> = ({
  onOpenChat,
}) => {
  const [loops, setLoops] = useState<Loop[]>([]);
  const [setup, setSetup] = useState<LoopTemplate | null>(null);
  const reload = useCallback(() => {
    loadLoops().then(setLoops);
  }, []);
  useEffect(reload, [reload]);

  const runNow = async (id: string) => {
    onOpenChat?.();
    const error = await runLoopNow(id);
    if (error) {
      Alert.alert('Not run', error);
    }
    reload();
  };

  return (
    <Card mode="outlined" testID="loops-section">
      <Card.Title
        title="Loops"
        subtitle="Ready-made jobs that come back on a timer, with next steps"
      />
      <Card.Content style={{gap: 8}}>
        {loops.map(l => (
          <View key={l.id} testID={`loop-${l.id}`} style={{gap: 4}}>
            <Text variant="titleSmall">
              {l.title}
              {l.paused ? ' (paused)' : isFinished(l) ? ' (finished)' : ''}
            </Text>
            <Text variant="bodySmall" numberOfLines={2}>
              {l.prompt}
            </Text>
            <Text variant="bodySmall">
              {l.runs} of {l.maxRuns} runs
              {isFinished(l)
                ? ''
                : ` · next ${new Date(l.nextAt).toLocaleString()}`}
            </Text>
            {l.log.slice(0, 3).map(e => (
              <Text key={`${e.at}${e.what}`} variant="bodySmall">
                {new Date(e.at).toLocaleString()}: {e.what}
              </Text>
            ))}
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
              {!isFinished(l) ? (
                <Button compact onPress={() => runNow(l.id)}>
                  Run now
                </Button>
              ) : null}
              <Button
                compact
                onPress={async () => {
                  await updateLoop(l.id, x =>
                    addLog(
                      {...x, paused: !x.paused},
                      x.paused ? 'Resumed' : 'Paused',
                    ),
                  );
                  reload();
                }}>
                {l.paused ? 'Resume' : 'Pause'}
              </Button>
              <Button
                compact
                onPress={async () => {
                  await stopLoop(l.id);
                  reload();
                }}>
                Stop
              </Button>
            </View>
          </View>
        ))}
        {setup ? (
          <Setup
            template={setup}
            onDone={() => {
              setSetup(null);
              reload();
            }}
          />
        ) : (
          <View style={{gap: 6}}>
            {LOOP_TEMPLATES.map(t => (
              <Card
                key={t.id}
                mode="contained"
                onPress={() => setSetup(t)}
                testID={`loop-template-${t.id}`}>
                <Card.Title
                  title={t.title}
                  subtitle={`${t.oneLine} (${EVERY_LABEL[t.every]})`}
                  subtitleNumberOfLines={2}
                />
              </Card>
            ))}
          </View>
        )}
      </Card.Content>
    </Card>
  );
};
