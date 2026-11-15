/**
 * Plans as a program, on screen (src/services/loops/plan.ts, planRunner.ts,
 * planStore.ts): a plain vertical step editor, the dry run, a run's live
 * panel (status, the question, guard choices, Pause / Next step / Stop,
 * the trace) and the versions list ("Go back"). Kept plain on purpose.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {View} from 'react-native';
import {Button, Chip, IconButton, Text, TextInput} from 'react-native-paper';

import {
  CHECK_LABEL,
  CHECK_TESTS,
  type CheckTest,
  dryRunPlan,
  GUARD_CAPS,
  GUARD_LABEL,
  KIND_LABEL,
  MAX_PLAN_STEPS,
  moveStep,
  newStep,
  ON_FAIL_LABEL,
  type OnFail,
  type Plan,
  type PlanGuards,
  type PlanStep,
  type PlanTools,
  removeStep,
  STEP_KINDS,
  type StepKind,
  validatePlan,
} from '../services/loops/plan';
import {
  answerQuestion,
  CHOICE_LABEL,
  GUARD_NAME,
  holdChoices,
  onPlanRunsChanged,
  pausePlanRun,
  type PlanRun,
  planRunOf,
  planToolsNow,
  resolveHold,
  stopPlanRun,
} from '../services/loops/planRunner';
import {
  currentPlan,
  onPlansChanged,
  type PlanVersion,
  planVersions,
  restorePlanVersion,
  savePlanEdit,
} from '../services/loops/planStore';

/** The built-in tools a plan may name (read once per screen). */
export function usePlanTools(): PlanTools {
  return useMemo(() => {
    try {
      return planToolsNow();
    } catch {
      return {};
    }
  }, []);
}

const ON_FAILS: OnFail[] = ['retry', 'skip', 'stop'];

/** "key: value" lines ↔ a tool's inputs (plain text values). */
const argsText = (args: PlanStep['args']) =>
  Object.entries(args ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
const parseArgs = (text: string): Record<string, string> =>
  Object.fromEntries(
    text
      .split('\n')
      .map(l => /^\s*([A-Za-z_][\w]*)\s*:\s*(.*)$/.exec(l))
      .filter((m): m is RegExpExecArray => !!m)
      .map(m => [m[1], m[2]]),
  );

const num = (text: string) => {
  const n = Number(text);
  return Number.isFinite(n) ? n : 0;
};

/** One step's fields, by kind. */
const StepFields: React.FC<{
  step: PlanStep;
  n: number;
  tools: PlanTools;
  on: string[];
  set: (s: PlanStep) => void;
}> = ({step, n, tools, on, set}) => {
  const [args, setArgs] = useState(argsText(step.args));
  const field = (
    label: string,
    value: string,
    change: (t: string) => void,
    opts: {multiline?: boolean; number?: boolean; testID?: string} = {},
  ) => (
    <TextInput
      mode="outlined"
      dense
      label={label}
      value={value}
      multiline={opts.multiline}
      keyboardType={opts.number ? 'number-pad' : undefined}
      onChangeText={change}
      testID={opts.testID}
    />
  );
  switch (step.kind) {
    case 'ask_model':
      return field(
        'Prompt ({{step:N}} = result of step N)',
        step.prompt ?? '',
        t => set({...step, prompt: t}),
        {multiline: true, testID: `plan-step-${n}-prompt`},
      );
    case 'use_tool':
      return (
        <>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
            {Object.keys(tools).map(t => (
              <Chip
                key={t}
                compact
                selected={step.tool === t}
                onPress={() => set({...step, tool: t})}>
                {t}
                {on.includes(t) ? '' : ' (off)'}
              </Chip>
            ))}
          </View>
          {field(
            `Inputs, one per line (${(tools[step.tool ?? ''] ?? []).join(', ') || 'none'})`,
            args,
            t => {
              setArgs(t);
              set({...step, args: parseArgs(t)});
            },
            {multiline: true},
          )}
        </>
      );
    case 'ask_user':
      return (
        <>
          {field('Question', step.question ?? '', t =>
            set({...step, question: t}),
          )}
          {field(
            'Choices (2 to 4, one per line)',
            (step.choices ?? []).join('\n'),
            t => set({...step, choices: t.split('\n')}),
            {multiline: true},
          )}
        </>
      );
    case 'wait':
      return field(
        'Seconds',
        String(step.seconds ?? ''),
        t => set({...step, seconds: num(t)}),
        {number: true},
      );
    case 'check':
      return (
        <>
          {field(
            'Step to check (number)',
            String(step.ref ?? ''),
            t => set({...step, ref: num(t)}),
            {number: true},
          )}
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
            {CHECK_TESTS.map((c: CheckTest) => (
              <Chip
                key={c}
                compact
                selected={step.test === c}
                onPress={() => set({...step, test: c})}>
                {CHECK_LABEL[c]}
              </Chip>
            ))}
          </View>
          {step.test !== 'changed'
            ? field('Value', step.value ?? '', t => set({...step, value: t}))
            : null}
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
            <Chip
              compact
              selected={step.ifNot !== 'end'}
              onPress={() => set({...step, ifNot: 'skip_next'})}>
              If not: skip the next step
            </Chip>
            <Chip
              compact
              selected={step.ifNot === 'end'}
              onPress={() => set({...step, ifNot: 'end'})}>
              If not: end (the repeat or the run)
            </Chip>
          </View>
        </>
      );
    case 'repeat':
      return (
        <View style={{flexDirection: 'row', gap: 8}}>
          <View style={{flex: 1}}>
            {field(
              'How many next steps',
              String(step.count ?? ''),
              t => set({...step, count: num(t)}),
              {number: true},
            )}
          </View>
          <View style={{flex: 1}}>
            {field(
              'Times (max 10)',
              String(step.times ?? ''),
              t => set({...step, times: num(t)}),
              {number: true},
            )}
          </View>
        </View>
      );
    case 'notify':
      return field('Text', step.text ?? '', t => set({...step, text: t}));
    case 'save':
      return (
        <>
          <View style={{flexDirection: 'row', gap: 4}}>
            <Chip
              compact
              selected={step.target !== 'workspace'}
              onPress={() => set({...step, target: 'memory', file: undefined})}>
              Memory
            </Chip>
            <Chip
              compact
              selected={step.target === 'workspace'}
              onPress={() =>
                set({
                  ...step,
                  target: 'workspace',
                  file: step.file ?? 'plan-notes.md',
                })
              }>
              Workspace file
            </Chip>
          </View>
          {step.target === 'workspace'
            ? field('File (.md or .txt)', step.file ?? '', t =>
                set({...step, file: t}),
              )
            : null}
          {field(
            'Text to add (asks first)',
            step.text ?? '',
            t => set({...step, text: t}),
            {multiline: true},
          )}
        </>
      );
  }
};

/**
 * The plan editor: a vertical list of steps (name, kind, inputs, time
 * limit, on failure; move, delete, add) and the guards. Shows the
 * validator's notes for the plan as it stands.
 */
export const PlanEditor: React.FC<{
  plan: Plan;
  onChange: (plan: Plan) => void;
  tools: PlanTools;
  on: string[];
  /** Notes from the draft (what was dropped). */
  notes?: string[];
}> = ({plan, onChange, tools, on, notes = []}) => {
  const [adding, setAdding] = useState(false);
  const checkNotes = validatePlan(plan, tools).notes;
  const setStep = (i: number, s: PlanStep) =>
    onChange({...plan, steps: plan.steps.map((x, j) => (j === i ? s : x))});
  const setGuard = (key: keyof PlanGuards, text: string) =>
    onChange({...plan, guards: {...plan.guards, [key]: num(text)}});
  return (
    <View style={{gap: 8}} testID="plan-editor">
      <Text variant="titleSmall">
        Steps the app runs ({plan.steps.length} of at most {MAX_PLAN_STEPS})
      </Text>
      {[...notes, ...checkNotes].map(n => (
        <Text key={n} variant="bodySmall">
          Note: {n}
        </Text>
      ))}
      {plan.steps.map((s, i) => (
        <View
          key={i}
          style={{
            gap: 4,
            borderLeftWidth: 2,
            paddingLeft: 8,
            borderColor: '#8884',
          }}
          testID={`plan-step-${i + 1}`}>
          <View style={{flexDirection: 'row', alignItems: 'center'}}>
            <Text variant="labelLarge" style={{flex: 1}}>
              {i + 1}. {KIND_LABEL[s.kind]}
            </Text>
            <IconButton
              icon="arrow-up"
              size={18}
              disabled={i === 0}
              onPress={() =>
                onChange({...plan, steps: moveStep(plan.steps, i, i - 1)})
              }
              accessibilityLabel={`Move step ${i + 1} up`}
            />
            <IconButton
              icon="arrow-down"
              size={18}
              disabled={i === plan.steps.length - 1}
              onPress={() =>
                onChange({...plan, steps: moveStep(plan.steps, i, i + 1)})
              }
              accessibilityLabel={`Move step ${i + 1} down`}
            />
            <IconButton
              icon="delete-outline"
              size={18}
              onPress={() =>
                onChange({...plan, steps: removeStep(plan.steps, i)})
              }
              accessibilityLabel={`Delete step ${i + 1}`}
            />
          </View>
          <TextInput
            mode="outlined"
            dense
            label="Name"
            value={s.name}
            onChangeText={t => setStep(i, {...s, name: t})}
          />
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
            {STEP_KINDS.map(k => (
              <Chip
                key={k}
                compact
                selected={s.kind === k}
                onPress={() =>
                  k !== s.kind &&
                  setStep(i, {
                    ...newStep(k),
                    name:
                      s.name === KIND_LABEL[s.kind] ? KIND_LABEL[k] : s.name,
                  })
                }>
                {KIND_LABEL[k]}
              </Chip>
            ))}
          </View>
          <StepFields
            key={`${i}-${s.kind}`}
            step={s}
            n={i + 1}
            tools={tools}
            on={on}
            set={x => setStep(i, x)}
          />
          {s.timeLimitSec > 0 ? (
            <TextInput
              mode="outlined"
              dense
              keyboardType="number-pad"
              label="Time limit (seconds, 5–600)"
              value={String(s.timeLimitSec)}
              onChangeText={t => setStep(i, {...s, timeLimitSec: num(t)})}
            />
          ) : null}
          {s.kind !== 'ask_user' &&
          s.kind !== 'repeat' &&
          s.kind !== 'wait' &&
          s.kind !== 'check' ? (
            <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
              {ON_FAILS.map(f => (
                <Chip
                  key={f}
                  compact
                  selected={s.onFail === f}
                  onPress={() => setStep(i, {...s, onFail: f})}>
                  If it fails: {ON_FAIL_LABEL[f].toLowerCase()}
                </Chip>
              ))}
            </View>
          ) : null}
        </View>
      ))}
      {plan.steps.length < MAX_PLAN_STEPS ? (
        adding ? (
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
            {STEP_KINDS.map((k: StepKind) => (
              <Chip
                key={k}
                compact
                onPress={() => {
                  onChange({...plan, steps: [...plan.steps, newStep(k)]});
                  setAdding(false);
                }}
                testID={`plan-add-${k}`}>
                {KIND_LABEL[k]}
              </Chip>
            ))}
          </View>
        ) : (
          <Button
            compact
            icon="plus"
            onPress={() => setAdding(true)}
            testID="plan-add-step">
            Add a step
          </Button>
        )
      ) : null}
      <Text variant="titleSmall">Guards per run (only you can raise them)</Text>
      {(Object.keys(GUARD_LABEL) as (keyof PlanGuards)[]).map(key => (
        <TextInput
          key={key}
          mode="outlined"
          dense
          keyboardType="number-pad"
          label={`${GUARD_LABEL[key]} (max ${GUARD_CAPS[key]})`}
          value={String(plan.guards[key] || '')}
          onChangeText={t => setGuard(key, t)}
        />
      ))}
      <Text variant="bodySmall">
        Also always on: the same step with the same result twice pauses it; a
        plan can't start another plan, schedule itself or change its own steps,
        tools or guards; tools stay behind their Toolbox switches and their own
        "Allow?".
      </Text>
    </View>
  );
};

/** The dry run of a plan: nothing runs, the model isn't asked. */
export const PlanDryRunView: React.FC<{plan: Plan; on: string[]}> = ({
  plan,
  on,
}) => {
  const dry = dryRunPlan(plan, on);
  return (
    <View style={{gap: 4}} testID="plan-dry-run">
      <Text variant="bodySmall">
        Dry run: nothing is run and the model isn't asked. Each run, step by
        step:
      </Text>
      {dry.lines.map(l => (
        <View key={l.n}>
          <Text variant="bodySmall">
            {l.n}. {l.name}: {l.what}
            {l.rounds > 1 ? ` (up to ${l.rounds} times)` : ''}
          </Text>
          {l.warn ? <Text variant="bodySmall"> {l.warn}</Text> : null}
        </View>
      ))}
      <Text variant="labelLarge">Questions it asks you</Text>
      <Text variant="bodySmall">
        {dry.questions.length ? dry.questions.join('\n') : 'None.'}
      </Text>
      <Text variant="labelLarge">At the most, per run</Text>
      <Text variant="bodySmall">
        {dry.most.steps} steps, {dry.most.model} model calls, {dry.most.tools}{' '}
        tool calls. Guards: {plan.guards.maxSteps} steps,{' '}
        {plan.guards.maxMinutes} min, {plan.guards.maxModelCalls} model calls,{' '}
        {plan.guards.maxToolCalls} tool calls.
      </Text>
      {dry.guardNotes.map(n => (
        <Text key={n} variant="bodySmall">
          {n}
        </Text>
      ))}
    </View>
  );
};

/** A loop's plan run, kept up to date. */
export function usePlanRun(loopId: string): PlanRun | undefined {
  const [run, setRun] = useState<PlanRun | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const read = () => {
      planRunOf(loopId)
        .then(r => live && setRun(r ? {...r} : undefined))
        .catch(() => {});
    };
    read();
    const off = onPlanRunsChanged(read);
    return () => {
      live = false;
      off();
    };
  }, [loopId]);
  return run;
}

const STATUS_TEXT: Record<PlanRun['status'], string> = {
  running: 'Running',
  asking: 'Waiting for your answer',
  paused: 'Paused',
  done: 'Done',
  stopped: 'Stopped',
};

/** The run's status, the question or hold choices, controls and trace. */
export const PlanRunPanel: React.FC<{run: PlanRun; traceLines?: number}> = ({
  run,
  traceLines = 5,
}) => {
  const [error, setError] = useState('');
  const [all, setAll] = useState(false);
  const act = async (p: Promise<string | undefined | void>) => {
    setError((await p) || '');
  };
  const next = run.plan.steps[run.pc];
  const trace = all ? run.trace : run.trace.slice(-traceLines);
  return (
    <View style={{gap: 4}} testID={`plan-run-${run.loopId}`}>
      <Text variant="bodySmall">
        Plan run (version {run.version}): {STATUS_TEXT[run.status]}
        {run.status === 'running' && next
          ? ` · step ${run.pc + 1} "${next.name}"`
          : ''}
        {run.block ? ` · round ${run.block.round} of ${run.block.times}` : ''} ·{' '}
        {run.counts.steps} steps, {run.counts.model} model, {run.counts.tools}{' '}
        tool calls
      </Text>
      {run.status === 'asking' && run.question ? (
        <>
          <Text variant="bodyMedium" testID="plan-question">
            {run.question.text}
          </Text>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
            {run.question.choices.map(c => (
              <Button
                key={c}
                mode="contained-tonal"
                compact
                onPress={() => act(answerQuestion(run.loopId, c))}
                testID={`plan-answer-${c}`}>
                {c}
              </Button>
            ))}
          </View>
        </>
      ) : null}
      {run.status === 'paused' && run.hold ? (
        <>
          <Text variant="bodyMedium" testID="plan-hold">
            {run.hold.guard ? `Guard hit: ${GUARD_NAME[run.hold.guard]}. ` : ''}
            {run.hold.why}
          </Text>
          <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
            {holdChoices(run).map(c => (
              <Button
                key={c}
                mode={c === 'stop' ? 'text' : 'contained-tonal'}
                compact
                onPress={() => act(resolveHold(run.loopId, c))}
                testID={`plan-choice-${c}`}>
                {CHOICE_LABEL[c]}
              </Button>
            ))}
          </View>
        </>
      ) : null}
      {run.status === 'running' || run.status === 'asking' ? (
        <View style={{flexDirection: 'row', gap: 4}}>
          {run.status === 'running' ? (
            <Button
              compact
              onPress={() => act(pausePlanRun(run.loopId))}
              disabled={run.pauseAsked}
              testID="plan-pause">
              {run.pauseAsked ? 'Pausing after this step…' : 'Pause'}
            </Button>
          ) : null}
          <Button
            compact
            onPress={() => act(stopPlanRun(run.loopId))}
            testID="plan-stop">
            Stop
          </Button>
        </View>
      ) : null}
      {error ? <Text variant="bodySmall">{error}</Text> : null}
      <Text variant="labelMedium">Trace</Text>
      {trace.map((t, i) => (
        <Text key={`${t.at}-${i}`} variant="bodySmall" selectable>
          {new Date(t.at).toLocaleTimeString()}{' '}
          {t.step ? `#${t.step} ${t.name}` : t.name}
          {t.input ? ` · in: ${t.input}` : ''}
          {t.output ? ` · out: ${t.output}` : ''}
          {t.note ? ` · ${t.note}` : ''}
        </Text>
      ))}
      {run.trace.length > traceLines ? (
        <Button compact onPress={() => setAll(!all)}>
          {all ? 'Show less' : `Show the whole trace (${run.trace.length})`}
        </Button>
      ) : null}
    </View>
  );
};

/** The kept versions of a plan, newest first, each with "Go back". */
export const PlanVersions: React.FC<{loopId: string; tools: PlanTools}> = ({
  loopId,
  tools,
}) => {
  const [list, setList] = useState<PlanVersion[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const read = () => {
      planVersions(loopId).then(v => live && setList(v));
    };
    read();
    const off = onPlansChanged(read);
    return () => {
      live = false;
      off();
    };
  }, [loopId]);
  const newest = list[list.length - 1];
  return (
    <View style={{gap: 2}} testID="plan-versions">
      <Text variant="titleSmall">Versions (the last 10 are kept)</Text>
      {[...list].reverse().map(v => (
        <View key={v.v} style={{flexDirection: 'row', alignItems: 'center'}}>
          <Text variant="bodySmall" style={{flex: 1}}>
            Version {v.v} · {new Date(v.at).toLocaleString()} · {v.note} ·{' '}
            {v.plan.steps.length} steps
            {v === newest ? ' (in use)' : ''}
          </Text>
          {v !== newest ? (
            <Button
              compact
              onPress={async () => {
                const r = await restorePlanVersion(loopId, v.v, tools);
                setError(r.ok ? '' : r.error);
              }}
              testID={`plan-go-back-${v.v}`}>
              Go back
            </Button>
          ) : null}
        </View>
      ))}
      {error ? <Text variant="bodySmall">{error}</Text> : null}
    </View>
  );
};

/** The plan in use for a loop, kept up to date. */
function useCurrentPlan(loopId: string): PlanVersion | undefined {
  const [v, setV] = useState<PlanVersion | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const read = () => {
      currentPlan(loopId).then(x => live && setV(x));
    };
    read();
    const off = onPlansChanged(read);
    return () => {
      live = false;
      off();
    };
  }, [loopId]);
  return v;
}

/** Steps on a plan loop's card: edit (a new version) and go back. */
const PlanStepsEdit: React.FC<{
  loopId: string;
  version: PlanVersion;
  tools: PlanTools;
  on: string[];
  onDone: () => void;
}> = ({loopId, version, tools, on, onDone}) => {
  const [plan, setPlan] = useState<Plan>(version.plan);
  const [error, setError] = useState('');
  return (
    <View style={{gap: 6}} testID={`plan-steps-edit-${loopId}`}>
      <PlanEditor plan={plan} onChange={setPlan} tools={tools} on={on} />
      {error ? <Text variant="bodySmall">{error}</Text> : null}
      <View style={{flexDirection: 'row', justifyContent: 'flex-end', gap: 4}}>
        <Button onPress={onDone}>Back</Button>
        <Button
          mode="contained"
          onPress={async () => {
            const r = await savePlanEdit(loopId, plan, tools);
            if (!r.ok) {
              setError(r.error);
              return;
            }
            onDone();
          }}
          testID="plan-steps-save">
          Save as a new version
        </Button>
      </View>
      <PlanVersions loopId={loopId} tools={tools} />
    </View>
  );
};

/**
 * A plan loop's part of its card in Toolbox → Loops: the plan's version,
 * Steps (edit, versions), Dry run, and the current or last run.
 */
export const PlanLoopCard: React.FC<{loopId: string; on: string[]}> = ({
  loopId,
  on,
}) => {
  const tools = usePlanTools();
  const version = useCurrentPlan(loopId);
  const run = usePlanRun(loopId);
  const [open, setOpen] = useState<'steps' | 'dry' | null>(null);
  if (!version) {
    return <Text variant="bodySmall">No plan saved for this loop.</Text>;
  }
  return (
    <View style={{gap: 4}}>
      <Text variant="bodySmall">
        Plan, version {version.v}: {version.plan.steps.length} steps the app
        runs. Guards: {version.plan.guards.maxSteps} steps,{' '}
        {version.plan.guards.maxMinutes} min,{' '}
        {version.plan.guards.maxModelCalls} model calls,{' '}
        {version.plan.guards.maxToolCalls} tool calls per run.
      </Text>
      <View style={{flexDirection: 'row', flexWrap: 'wrap', gap: 4}}>
        <Button
          compact
          onPress={() => setOpen(open === 'steps' ? null : 'steps')}
          testID={`plan-steps-open-${loopId}`}>
          Steps
        </Button>
        <Button
          compact
          onPress={() => setOpen(open === 'dry' ? null : 'dry')}
          testID={`plan-dry-open-${loopId}`}>
          Dry run
        </Button>
      </View>
      {open === 'steps' ? (
        <PlanStepsEdit
          key={version.v}
          loopId={loopId}
          version={version}
          tools={tools}
          on={on}
          onDone={() => setOpen(null)}
        />
      ) : null}
      {open === 'dry' ? <PlanDryRunView plan={version.plan} on={on} /> : null}
      {run ? <PlanRunPanel run={run} /> : null}
    </View>
  );
};
