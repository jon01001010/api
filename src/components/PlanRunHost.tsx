/**
 * App-wide: shows a loop plan's run (src/services/loops/planRunner.ts)
 * wherever the user is: its progress with Pause / Stop, an "ask me"
 * question (its choices only), or why it paused (a guard, a failed step,
 * the app restarting) with the user's choices. "Hide" hides it until the
 * run needs something new; the same panel is on the loop's card in
 * Toolbox → Loops. Mounted before the file approval host, so a tool's own
 * "Allow?" shows above it.
 */
import * as React from 'react';
import {ScrollView} from 'react-native';
import {Button, Dialog, Portal} from 'react-native-paper';

import {
  allPlanRuns,
  onPlanRunsChanged,
  type PlanRun,
} from '../services/loops/planRunner';
import {PlanRunPanel} from '../screens/PlanParts';

/** What the run shows now: hiding lasts until this changes. */
const stateOf = (r: PlanRun) =>
  `${r.id}:${r.status}:${r.hold?.why ?? ''}:${r.question?.step ?? ''}`;

const wantsUser = (r: PlanRun) =>
  r.status === 'asking' || (r.status === 'paused' && !!r.hold);

export function PlanRunHost(): React.JSX.Element {
  const [run, setRun] = React.useState<PlanRun | undefined>(undefined);
  const [hidden, setHidden] = React.useState<string>('');
  React.useEffect(() => {
    let live = true;
    const read = () => {
      // The first read also finds runs the app was closed during.
      allPlanRuns()
        .then(list => {
          if (!live) {
            return;
          }
          const pick =
            list.find(wantsUser) ?? list.find(r => r.status === 'running');
          setRun(pick ? {...pick} : undefined);
        })
        .catch(() => {});
    };
    read();
    const off = onPlanRunsChanged(read);
    return () => {
      live = false;
      off();
    };
  }, []);
  const step = run?.inFlight
    ? run.plan.steps[run.inFlight.step - 1]
    : undefined;
  // A tool or save step may show its own "Allow?": keep out of its way.
  const toolAsking =
    run?.status === 'running' &&
    (step?.kind === 'use_tool' || step?.kind === 'save');
  const visible = !!run && !toolAsking && hidden !== stateOf(run);
  return (
    <Portal>
      <Dialog visible={visible} dismissable={false} testID="plan-run-host">
        <Dialog.Title>Plan: {run?.title ?? ''}</Dialog.Title>
        <Dialog.ScrollArea style={{maxHeight: 420}}>
          <ScrollView>
            {run ? <PlanRunPanel run={run} traceLines={3} /> : null}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button
            onPress={() => run && setHidden(stateOf(run))}
            testID="plan-run-host-hide">
            Hide
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
