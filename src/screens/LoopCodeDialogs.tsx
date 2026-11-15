/**
 * Loops shared as codes (src/services/loops/loopShare.ts): Share on a
 * loop's card (QR, copy code, file), and the review shown when Toolbox →
 * Scan QR / Paste a code reads a `PA1:L:` code: every step, the schedule,
 * the limits and the dry run, before it is installed paused (not started).
 */
import React from 'react';
import {View} from 'react-native';
import {Text} from 'react-native-paper';

import {CUSTOM_USES, summary, type Loop} from '../services/loops/loops';
import {loopCodeFilename, packLoop} from '../services/loops/loopShare';
import {planOfLoop} from '../services/loops/makeLoop';
import {LoopDryRunDetails, useSwitchedOnTools} from './LoopParts';
import {ShareCodeDialog} from './ShareCodeDialog';

export const LoopShareDialog: React.FC<{
  loop: Loop | null;
  onDismiss: () => void;
}> = ({loop, onDismiss}) => (
  <ShareCodeDialog
    visible={loop !== null}
    title={'Share ' + (loop?.title ?? '')}
    code={loop ? packLoop(loop) : ''}
    filename={loopCodeFilename(loop?.title ?? 'loop')}
    what="loop"
    hint="Only the loop itself is shared: its steps, how often, its limits and battery guard. Not its runs, log or chat. The other device scans this in Toolbox → Scan QR, or pastes the code; it sees the whole loop first, and the loop arrives paused until they press Start."
    testPrefix="loop-share"
    onDismiss={onDismiss}
  />
);

/** A shared loop before it is installed: all of it, and its dry run. */
export const SharedLoopReview: React.FC<{loop: Loop}> = ({loop}) => {
  const tools = useSwitchedOnTools();
  const plan = planOfLoop(loop);
  return (
    <View testID="loop-receive-review" style={{gap: 6}}>
      <Text variant="bodySmall">
        Someone shared this loop. Check every part of it. Nothing has run; it is
        installed paused and only starts when you press Start on its card in
        Toolbox → Loops.
      </Text>
      <Text variant="titleSmall" testID="loop-receive-title">
        {loop.title}
      </Text>
      {plan && plan.steps.length ? (
        <>
          <Text variant="labelLarge">Each run should</Text>
          <Text variant="bodySmall" selectable>
            {plan.goal}
          </Text>
          <Text variant="labelLarge">Steps ({plan.steps.length})</Text>
          {plan.steps.map((s, i) => (
            <Text
              key={`${i}${s}`}
              variant="bodySmall"
              selectable
              testID={`loop-receive-step-${i}`}>
              {i + 1}. {s}
            </Text>
          ))}
        </>
      ) : null}
      <Text variant="labelLarge">Schedule and limits</Text>
      <Text variant="bodySmall" testID="loop-receive-summary">
        {summary(loop, tools)}
      </Text>
      <Text variant="labelLarge">Dry run</Text>
      <LoopDryRunDetails loop={loop} uses={CUSTOM_USES} />
    </View>
  );
};
