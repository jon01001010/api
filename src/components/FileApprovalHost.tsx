import * as React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {Button, Checkbox, Dialog, Portal, Text} from 'react-native-paper';
import {
  FileProposal,
  subscribeFileApprovals,
  decideFileApproval,
} from '../services/talents/fileApprovalGate';
import {MODEL_THINKING} from '../services/agent/chatGuard';
import {MODEL_SAYS} from '../services/agent/subAgent';

const ACTION_LABEL: Record<FileProposal['action'], string> = {
  file_create: 'creation',
  file_edit: 'edit',
  file_append: 'append',
  file_patch: 'patch',
  file_undo: 'undo',
  phone_action: 'phone action',
  custom_tool: 'custom tool',
  sends_out: 'sending',
  too_many: 'questions',
  ask_other_model: 'hand-off',
  handoff_cap: 'hand-offs',
  ask_models: 'hand-offs',
  ask_model_chain: 'hand-offs',
};

/** An app-written warning, in red, with the facts. */
function RedAlert({proposal}: {proposal: FileProposal}) {
  return proposal.alert ? (
    <Text variant="bodyMedium" style={styles.warning} testID="approval-alert">
      {proposal.alert}
    </Text>
  ) : null;
}

/** After the facts: the model's own words for the request. */
function ModelSays({proposal}: {proposal: FileProposal}) {
  return proposal.modelSays ? (
    <View style={styles.thinking}>
      <Text variant="labelMedium">{MODEL_SAYS}</Text>
      <Text variant="bodySmall" selectable testID="approval-model-says">
        {proposal.modelSays}
      </Text>
    </View>
  ) : null;
}

/**
 * After the facts: the model's thinking from just before the request
 * (chatGuard.thinkingShown), with a red warning line when it talks about
 * hiding things or getting around checks.
 */
function Thinking({proposal}: {proposal: FileProposal}) {
  if (!proposal.thinking && !proposal.warning) {
    return null;
  }
  return (
    <View style={styles.thinking}>
      {!!proposal.warning && (
        <Text
          variant="bodySmall"
          style={styles.warning}
          testID="thinking-warning">
          {proposal.warning}
        </Text>
      )}
      {!!proposal.thinking && (
        <>
          <Text variant="labelMedium">{MODEL_THINKING}</Text>
          <Text variant="bodySmall" selectable testID="approval-thinking">
            {proposal.thinking}
          </Text>
        </>
      )}
    </View>
  );
}

/** "Don't allow anything more in this chat", on every question from a chat. */
function NothingMore({proposal}: {proposal: FileProposal}) {
  if (!proposal.chat || proposal.action === 'too_many') {
    return null;
  }
  return (
    <Button
      testID="approval-nothing-more"
      onPress={() => decideFileApproval(false, true)}>
      Don't allow anything more in this chat
    </Button>
  );
}

/**
 * Several models (ask_models, ask_model_chain): facts first, then every
 * target (for ask_models with a box each, ticked to start; Allow sends to
 * the ticked ones only), the exact text, then the model's words.
 */
function ManyModelsDialog({proposal}: {proposal: FileProposal}) {
  const targets = proposal.targets ?? [];
  const boxes = proposal.action === 'ask_models';
  const [ticked, setTicked] = React.useState<string[]>(() =>
    targets.map(t => t.id),
  );
  const toggle = (id: string) =>
    setTicked(now =>
      now.includes(id) ? now.filter(x => x !== id) : [...now, id],
    );
  return (
    <Portal>
      <Dialog visible dismissable={false} testID="ask-models-approval">
        <Dialog.Title>
          {boxes
            ? 'Hand this to several models?'
            : 'Hand this to a chain of models?'}
        </Dialog.Title>
        <Dialog.Content>
          <ScrollView style={styles.scroll} nestedScrollEnabled>
            <RedAlert proposal={proposal} />
            <Text variant="bodyMedium" selectable>
              {proposal.filename}
            </Text>
            <Text variant="labelMedium" style={styles.thinking}>
              {boxes ? 'Send to:' : 'In this order:'}
            </Text>
            {targets.map((t, i) =>
              boxes ? (
                <View key={t.id}>
                  <Checkbox.Item
                    testID={`approval-target-${t.id}`}
                    label={t.label}
                    status={ticked.includes(t.id) ? 'checked' : 'unchecked'}
                    onPress={() => toggle(t.id)}
                    position="leading"
                  />
                  <Text variant="bodySmall" style={styles.detail}>
                    {t.detail}
                  </Text>
                </View>
              ) : (
                <View key={t.id} testID={`approval-target-${t.id}`}>
                  <Text variant="bodyMedium">
                    {i + 1}. {t.label}
                  </Text>
                  <Text variant="bodySmall" style={styles.detail}>
                    {t.detail}
                  </Text>
                </View>
              ),
            )}
            <Text variant="labelMedium" style={styles.thinking}>
              Exactly this text will be sent:
            </Text>
            <Text
              variant="bodySmall"
              selectable
              style={styles.sent}
              testID="approval-sent-text">
              {proposal.content}
            </Text>
            <ModelSays proposal={proposal} />
            <Thinking proposal={proposal} />
          </ScrollView>
        </Dialog.Content>
        <Dialog.Actions style={styles.actions}>
          <NothingMore proposal={proposal} />
          <Button onPress={() => decideFileApproval(false)}>Deny</Button>
          <Button
            mode="contained"
            testID="approval-allow"
            disabled={boxes && !ticked.length}
            onPress={() =>
              decideFileApproval(true, false, boxes ? ticked : undefined)
            }>
            {boxes && ticked.length < targets.length
              ? `Allow once (${ticked.length} of ${targets.length})`
              : 'Allow once'}
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

/** Shows the line changes and the complete proposed content, never a truncated approval summary. */
export function FileApprovalHost(): React.JSX.Element {
  const [proposal, setProposal] = React.useState<FileProposal | null>(null);
  React.useEffect(() => subscribeFileApprovals(setProposal), []);
  if (proposal?.action === 'too_many' || proposal?.action === 'handoff_cap') {
    // Not answerable by the model: only these two buttons.
    return (
      <Portal>
        <Dialog visible dismissable={false} testID="too-many-questions">
          <Dialog.Title>
            {proposal.action === 'handoff_cap'
              ? 'Hand-off limit reached'
              : 'The model is asking a lot'}
          </Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium">{proposal.filename}</Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => decideFileApproval(false)}>Stop</Button>
            <Button mode="contained" onPress={() => decideFileApproval(true)}>
              Continue
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    );
  }
  if (
    proposal?.action === 'ask_models' ||
    proposal?.action === 'ask_model_chain'
  ) {
    // A new question starts with every box ticked.
    return (
      <ManyModelsDialog key={JSON.stringify(proposal)} proposal={proposal} />
    );
  }
  if (proposal?.action === 'ask_other_model') {
    // Facts first (app-written), the exact text, then the model's words.
    return (
      <Portal>
        <Dialog visible dismissable={false} testID="ask-other-model-approval">
          <Dialog.Title>Hand this to another model?</Dialog.Title>
          <Dialog.Content>
            <ScrollView style={styles.scroll} nestedScrollEnabled>
              <RedAlert proposal={proposal} />
              <Text variant="bodyMedium" selectable>
                {proposal.filename}
              </Text>
              <Text variant="labelMedium" style={styles.thinking}>
                Exactly this text will be sent:
              </Text>
              <Text
                variant="bodySmall"
                selectable
                style={styles.sent}
                testID="approval-sent-text">
                {proposal.content}
              </Text>
              <ModelSays proposal={proposal} />
              <Thinking proposal={proposal} />
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions style={styles.actions}>
            <NothingMore proposal={proposal} />
            <Button onPress={() => decideFileApproval(false)}>Deny</Button>
            <Button mode="contained" onPress={() => decideFileApproval(true)}>
              Allow once
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    );
  }
  return (
    <Portal>
      {proposal?.action === 'phone_action' ||
      proposal?.action === 'custom_tool' ||
      proposal?.action === 'sends_out' ? (
        <Dialog visible dismissable={false} testID="phone-action-approval">
          <Dialog.Title>
            {proposal.action === 'custom_tool'
              ? 'Save this tool?'
              : proposal.action === 'sends_out'
                ? 'Send this out?'
                : 'Allow this on your phone?'}
          </Dialog.Title>
          <Dialog.Content>
            <ScrollView style={styles.scroll} nestedScrollEnabled>
              <Text variant="bodyLarge" selectable>
                {proposal.filename}
              </Text>
              {!!proposal.content && (
                <Text variant="bodySmall" selectable style={{marginTop: 8}}>
                  {proposal.content}
                </Text>
              )}
              <Thinking proposal={proposal} />
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions style={styles.actions}>
            <NothingMore proposal={proposal} />
            <Button onPress={() => decideFileApproval(false)}>Deny</Button>
            <Button mode="contained" onPress={() => decideFileApproval(true)}>
              Allow once
            </Button>
          </Dialog.Actions>
        </Dialog>
      ) : (
        <Dialog visible={proposal !== null} dismissable={false}>
          <Dialog.Title>
            Approve file {ACTION_LABEL[proposal?.action ?? 'file_create']}?
          </Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyMedium" selectable>
              {proposal?.filename ?? ''}
            </Text>
            <Text variant="bodySmall">
              The model proposes the complete content below. Review it before
              saving. Original imported files are never overwritten.
            </Text>
            <ScrollView
              style={{maxHeight: 320, marginTop: 12}}
              nestedScrollEnabled>
              <View style={{padding: 8}}>
                {proposal?.diff !== undefined && (
                  <>
                    <Text variant="labelMedium">Changes</Text>
                    <Text selectable variant="bodySmall" style={styles.diff}>
                      {proposal.diff}
                    </Text>
                  </>
                )}
                <Text variant="labelMedium">Proposed full contents</Text>
                <Text selectable variant="bodySmall">
                  {proposal?.content ?? ''}
                </Text>
                {proposal?.previous !== undefined && (
                  <>
                    <Text variant="labelMedium" style={{marginTop: 12}}>
                      Previous full contents
                    </Text>
                    <Text selectable variant="bodySmall">
                      {proposal.previous}
                    </Text>
                  </>
                )}
                {proposal && <Thinking proposal={proposal} />}
              </View>
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions style={styles.actions}>
            {proposal && <NothingMore proposal={proposal} />}
            <Button onPress={() => decideFileApproval(false)}>Deny</Button>
            <Button mode="contained" onPress={() => decideFileApproval(true)}>
              Approve once
            </Button>
          </Dialog.Actions>
        </Dialog>
      )}
    </Portal>
  );
}

const styles = StyleSheet.create({
  diff: {fontFamily: 'JetBrainsMono-Regular', marginBottom: 12},
  scroll: {maxHeight: 420},
  detail: {opacity: 0.7, marginLeft: 8, marginBottom: 4},
  sent: {fontFamily: 'JetBrainsMono-Regular', marginTop: 4},
  thinking: {marginTop: 12},
  warning: {color: '#C62828', fontWeight: 'bold', marginBottom: 6},
  actions: {flexWrap: 'wrap'},
});
