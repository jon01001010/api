/**
 * Toolbox → Loops → "Make a loop": one sentence and a detail level; the
 * loaded model drafts a loop (src/services/loops/makeLoop.ts); the user
 * checks and edits every part of it, sees the whole prompt, and presses
 * Start. Nothing runs before Start.
 */
import React, {useEffect, useState} from 'react';
import {Alert, View} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Card,
  Chip,
  IconButton,
  Text,
  TextInput,
} from 'react-native-paper';

import {
  CUSTOM_LOOP_ID,
  EVERY_LABEL,
  type Every,
  MAX_DAYS,
  MAX_RUNS,
  startLoop,
  summary,
} from '../services/loops/loops';
import {
  blankDraft,
  cancelDraft,
  DETAIL_LEVELS,
  type DetailLevel,
  draftLoop,
  type LoopDraft,
  loopPromptOf,
  MAX_PLAN_STEPS,
  MAX_STEP,
  MAX_TITLE,
  parseAt,
  previewOf,
} from '../services/loops/makeLoop';

const EVERY: Every[] = ['hour', '3hours', 'day', 'week'];
const LEVELS: DetailLevel[] = ['short', 'normal', 'detailed'];

const timeText = (at?: {hour: number; minute: number}) =>
  at
    ? `${String(at.hour).padStart(2, '0')}:${String(at.minute).padStart(2, '0')}`
    : '09:00';

const Review: React.FC<{
  initial: LoopDraft;
  onBack: () => void;
  onDone: () => void;
}> = ({initial, onBack, onDone}) => {
  const [draft, setDraft] = useState<LoopDraft>(initial);
  const [time, setTime] = useState(timeText(initial.at));
  const [runs, setRuns] = useState(String(initial.maxRuns));
  const [days, setDays] = useState(String(initial.days));
  const [newStep, setNewStep] = useState('');
  const [error, setError] = useState('');
  const timed = draft.every === 'day' || draft.every === 'week';

  const current: LoopDraft = {
    ...draft,
    at: timed ? parseAt(time) : undefined,
    maxRuns: Number(runs) || initial.maxRuns,
    days: Number(days) || initial.days,
    steps: draft.steps.map(s => s.trim()).filter(Boolean),
  };
  const prompt = loopPromptOf(current);

  const setStep = (i: number, text: string) =>
    setDraft({
      ...draft,
      steps: draft.steps.map((s, j) => (j === i ? text : s)),
    });
  const move = (i: number, by: number) => {
    const j = i + by;
    if (j < 0 || j >= draft.steps.length) {
      return;
    }
    const steps = [...draft.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    setDraft({...draft, steps});
  };
  const remove = (i: number) =>
    setDraft({...draft, steps: draft.steps.filter((_, j) => j !== i)});
  const add = () => {
    if (!newStep.trim() || draft.steps.length >= MAX_PLAN_STEPS) {
      return;
    }
    setDraft({...draft, steps: [...draft.steps, newStep.trim()]});
    setNewStep('');
  };

  const start = async () => {
    if (timed && !current.at) {
      setError('Time as HH:MM, e.g. 07:30');
      return;
    }
    const r = await startLoop({
      templateId: CUSTOM_LOOP_ID,
      values: {},
      custom: {title: current.title, prompt},
      every: current.every,
      at: current.at,
      maxRuns: current.maxRuns,
      days: current.days,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    Alert.alert(`Started: ${r.loop.title}`, summary(r.loop));
    onDone();
  };

  return (
    <View style={{gap: 8}} testID="make-loop-review">
      <Text variant="bodySmall">
        Check the plan and change anything. Nothing runs until you press Start.
      </Text>
      <TextInput
        mode="outlined"
        dense
        label="Name"
        maxLength={MAX_TITLE}
        value={draft.title}
        onChangeText={title => setDraft({...draft, title})}
        testID="make-loop-title"
      />
      <TextInput
        mode="outlined"
        dense
        multiline
        label="Each run should"
        value={draft.prompt}
        onChangeText={p => setDraft({...draft, prompt: p})}
        testID="make-loop-goal"
      />
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
        {EVERY.map(e => (
          <Chip
            key={e}
            selected={draft.every === e}
            onPress={() => setDraft({...draft, every: e})}>
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
      <Text variant="titleSmall">
        Steps ({draft.steps.length} of at most {MAX_PLAN_STEPS})
      </Text>
      {draft.steps.map((s, i) => (
        <View
          key={i}
          style={{flexDirection: 'row', alignItems: 'center'}}
          testID={`make-loop-step-${i}`}>
          <TextInput
            style={{flex: 1}}
            mode="outlined"
            dense
            label={`Step ${i + 1}`}
            maxLength={MAX_STEP}
            value={s}
            onChangeText={t => setStep(i, t)}
          />
          <IconButton
            icon="arrow-up"
            size={18}
            disabled={i === 0}
            onPress={() => move(i, -1)}
            accessibilityLabel={`Move step ${i + 1} up`}
          />
          <IconButton
            icon="arrow-down"
            size={18}
            disabled={i === draft.steps.length - 1}
            onPress={() => move(i, 1)}
            accessibilityLabel={`Move step ${i + 1} down`}
          />
          <IconButton
            icon="delete-outline"
            size={18}
            onPress={() => remove(i)}
            accessibilityLabel={`Delete step ${i + 1}`}
          />
        </View>
      ))}
      {draft.steps.length < MAX_PLAN_STEPS ? (
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <TextInput
            style={{flex: 1}}
            mode="outlined"
            dense
            label="Add a step"
            maxLength={MAX_STEP}
            value={newStep}
            onChangeText={setNewStep}
            onSubmitEditing={add}
            testID="make-loop-add-step"
          />
          <IconButton icon="plus" size={18} onPress={add} />
        </View>
      ) : null}
      <Text variant="bodySmall">{summary(previewOf(current))}</Text>
      <Text variant="titleSmall">What the model gets each run</Text>
      <Text variant="bodySmall" selectable testID="make-loop-prompt">
        {prompt || '(empty)'}
      </Text>
      {error ? <Text variant="bodySmall">{error}</Text> : null}
      <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 4}}>
        <Button onPress={onBack}>Back</Button>
        <Button mode="contained" onPress={start} testID="make-loop-start">
          Start
        </Button>
      </View>
    </View>
  );
};

export const MakeLoopSheet: React.FC<{onDone: () => void}> = ({onDone}) => {
  const [sentence, setSentence] = useState('');
  const [level, setLevel] = useState<DetailLevel>('normal');
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<LoopDraft | null>(null);
  // Leaving the screen stops a draft being written.
  useEffect(() => cancelDraft, []);

  const ask = async () => {
    setError('');
    setDrafting(true);
    try {
      const r = await draftLoop(sentence, level);
      if (r.ok) {
        setDraft(r.draft);
      } else if (r.error !== 'Cancelled') {
        setError(r.error);
      }
    } finally {
      setDrafting(false);
    }
  };

  return (
    <Card mode="outlined" testID="make-loop">
      <Card.Title
        title="Make a loop"
        subtitle="Say what you want; the model drafts a plan for you to check"
        subtitleNumberOfLines={2}
      />
      <Card.Content style={{gap: 8}}>
        {draft ? (
          <Review
            initial={draft}
            onBack={() => setDraft(null)}
            onDone={onDone}
          />
        ) : (
          <>
            <TextInput
              mode="outlined"
              dense
              label="In one sentence"
              placeholder="help me get fit before summer"
              value={sentence}
              onChangeText={setSentence}
              editable={!drafting}
              testID="make-loop-sentence"
            />
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 6}}>
              {LEVELS.map(l => (
                <Chip
                  key={l}
                  selected={level === l}
                  onPress={() => setLevel(l)}
                  disabled={drafting}>
                  {DETAIL_LEVELS[l].label}
                </Chip>
              ))}
            </View>
            {drafting ? (
              <View
                style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
                <ActivityIndicator size="small" />
                <Text variant="bodySmall">The model is drafting a plan…</Text>
              </View>
            ) : null}
            {error ? (
              <Text variant="bodySmall" testID="make-loop-error">
                {error}
              </Text>
            ) : null}
            <View
              style={{
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                gap: 4,
              }}>
              {drafting ? (
                <Button onPress={cancelDraft}>Stop</Button>
              ) : (
                <>
                  <Button onPress={onDone}>Cancel</Button>
                  <Button
                    onPress={() => setDraft(blankDraft(sentence))}
                    testID="make-loop-myself">
                    Write it myself
                  </Button>
                  <Button
                    mode="contained"
                    disabled={!sentence.trim()}
                    onPress={ask}
                    testID="make-loop-draft">
                    {error ? 'Try again' : 'Draft'}
                  </Button>
                </>
              )}
            </View>
          </>
        )}
      </Card.Content>
    </Card>
  );
};
