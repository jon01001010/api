/**
 * Toolbox → Loops: the ready-made loops gallery and the running loops
 * (src/services/loops). Pick one, fill in the blanks, choose how often,
 * press Start, check the dry run, "Looks right, start". Nothing runs
 * without a tap: when one is due the app asks. A running loop's card has
 * Edit (only the user edits a loop).
 */
import React, {useCallback, useEffect, useState} from 'react';
import {Alert, View} from 'react-native';
import {Button, Card, Chip, Switch, Text, TextInput} from 'react-native-paper';

import {
  LOOP_TEMPLATES,
  type LoopTemplate,
} from '../services/loops/loopTemplates';
import {
  type BatteryGuard,
  batteryText,
  buildLoop,
  CUSTOM_LOOP_ID,
  DEFAULT_BATTERY,
  EVERY_LABEL,
  editLoop,
  type Every,
  isFinished,
  loadLoops,
  type Loop,
  type LoopEdit,
  type LoopInput,
  MAX_DAYS,
  MAX_RUNS,
  saveLoopEdit,
  stopLoop,
  summary,
  togglePause,
  updateLoop,
} from '../services/loops/loops';
import {
  cleanLine,
  cleanSteps,
  draftOfLoop,
  type LoopDraft,
  MAX_GOAL,
  MAX_PLAN_STEPS,
  planOfLoop,
} from '../services/loops/makeLoop';
import {runLoopNow} from '../services/loops/loopRunner';
import {DryRunOf, LoopDraftEditor, MakeLoopSheet} from './MakeLoopSheet';
import {BatteryPicker} from './LoopParts';
import {isLoopNotifyOn, setLoopNotifyOn} from '../services/loops/loopNotify';
import {ensureNotificationPermission} from '../utils/androidPermission';

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
  const [battery, setBattery] = useState<BatteryGuard>(DEFAULT_BATTERY);
  const [error, setError] = useState('');
  /** Start pressed: the dry run of this input, before anything starts. */
  const [checking, setChecking] = useState<LoopInput | null>(null);
  const timed = every === 'day' || every === 'week';

  const start = () => {
    const at = timed ? parseTime(time) : undefined;
    if (timed && !at) {
      setError('Time as HH:MM, e.g. 07:30');
      return;
    }
    const input: LoopInput = {
      templateId: template.id,
      values,
      every,
      at,
      maxRuns: Number(runs) || template.maxRuns,
      days: Number(days) || template.days,
      battery,
    };
    const built = buildLoop(input);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setError('');
    setChecking(input);
  };

  if (checking) {
    return (
      <Card mode="outlined" testID={`loop-setup-${template.id}`}>
        <Card.Content>
          <DryRunOf
            input={checking}
            uses={template.uses}
            onBack={() => setChecking(null)}
            onDone={onDone}
          />
        </Card.Content>
      </Card>
    );
  }

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
        <BatteryPicker value={battery} onChange={setBattery} />
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

/** Edit on a running loop's card: keeps runs so far and the log. */
const EditLoop: React.FC<{loop: Loop; onDone: () => void}> = ({
  loop,
  onDone,
}) => {
  const [initial] = useState(() => draftOfLoop(loop));
  const withSteps =
    loop.templateId === CUSTOM_LOOP_ID && planOfLoop(loop) !== undefined;
  const toEdit = (d: LoopDraft, prompt: string): LoopEdit => ({
    title: d.title,
    prompt,
    plan: withSteps
      ? {
          goal: cleanLine(d.prompt, MAX_GOAL),
          steps: cleanSteps(d.steps, MAX_PLAN_STEPS),
        }
      : undefined,
    every: d.every,
    at: d.at,
    maxRuns: d.maxRuns,
    days: d.days,
    battery: d.battery,
  });
  return (
    <View testID={`loop-edit-${loop.id}`}>
      <LoopDraftEditor
        initial={initial}
        withSteps={withSteps}
        intro={`Edit "${loop.title}". Runs so far (${loop.runs}) and the log are kept; a new time moves the next run.`}
        saveLabel="Save"
        saveTestID="loop-edit-save"
        runsDone={loop.runs}
        describe={(d, prompt) => {
          const r = editLoop(loop, toEdit(d, prompt));
          return r.ok ? summary(r.loop) : r.error;
        }}
        onBack={onDone}
        onSave={async (d, prompt) => {
          const r = await saveLoopEdit(loop.id, toEdit(d, prompt));
          if (!r.ok) {
            return r.error;
          }
          onDone();
          return undefined;
        }}
      />
    </View>
  );
};

export const LoopsSection: React.FC<{onOpenChat?: () => void}> = ({
  onOpenChat,
}) => {
  const [loops, setLoops] = useState<Loop[]>([]);
  const [setup, setSetup] = useState<LoopTemplate | null>(null);
  const [making, setMaking] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [notify, setNotify] = useState(true);
  const reload = useCallback(() => {
    loadLoops().then(setLoops);
    isLoopNotifyOn().then(setNotify);
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
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
          <View style={{flex: 1}}>
            <Text variant="bodyMedium">Notify when a loop is due</Text>
            <Text variant="bodySmall">
              Also with the app closed (may be a few minutes late). Tap it to
              choose Run now, Later or Skip; it never runs by itself.
            </Text>
          </View>
          <Switch
            value={notify}
            onValueChange={async on => {
              setNotify(on);
              if (on) {
                await ensureNotificationPermission();
              }
              await setLoopNotifyOn(on);
            }}
            testID="loops-notify-switch"
          />
        </View>
        {loops.map(l =>
          editing === l.id ? (
            <EditLoop
              key={l.id}
              loop={l}
              onDone={() => {
                setEditing(null);
                reload();
              }}
            />
          ) : (
            <View key={l.id} testID={`loop-${l.id}`} style={{gap: 4}}>
              <Text variant="titleSmall">
                {l.title}
                {l.paused ? ' (paused)' : isFinished(l) ? ' (finished)' : ''}
              </Text>
              {l.paused && l.pausedWhy ? (
                <Text variant="bodySmall" testID={`loop-why-${l.id}`}>
                  Paused: {l.pausedWhy}. Edit it, or Resume to try again.
                </Text>
              ) : null}
              <Text variant="bodySmall" numberOfLines={2}>
                {l.prompt}
              </Text>
              <Text variant="bodySmall">
                {l.runs} of {l.maxRuns} runs
                {isFinished(l)
                  ? ''
                  : ` · next ${new Date(l.nextAt).toLocaleString()}`}
              </Text>
              <Text variant="bodySmall">
                Phone: {batteryText(l.battery).toLowerCase()}
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
                  onPress={() => setEditing(l.id)}
                  testID={`loop-edit-open-${l.id}`}>
                  Edit
                </Button>
                <Button
                  compact
                  onPress={async () => {
                    await updateLoop(l.id, x => togglePause(x));
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
          ),
        )}
        {making ? (
          <MakeLoopSheet
            onDone={() => {
              setMaking(false);
              reload();
            }}
          />
        ) : setup ? (
          <Setup
            template={setup}
            onDone={() => {
              setSetup(null);
              reload();
            }}
          />
        ) : (
          <View style={{gap: 6}}>
            <Button
              mode="contained-tonal"
              icon="pencil-plus-outline"
              onPress={() => setMaking(true)}
              testID="make-loop-open">
              Make a loop
            </Button>
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
