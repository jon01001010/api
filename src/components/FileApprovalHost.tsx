import * as React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {Button, Dialog, Portal, Text} from 'react-native-paper';
import {
  FileProposal,
  subscribeFileApprovals,
  decideFileApproval,
} from '../services/talents/fileApprovalGate';
import {MODEL_THINKING} from '../services/agent/chatGuard';

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
};

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

/** Shows the line changes and the complete proposed content, never a truncated approval summary. */
export function FileApprovalHost(): React.JSX.Element {
  const [proposal, setProposal] = React.useState<FileProposal | null>(null);
  React.useEffect(() => subscribeFileApprovals(setProposal), []);
  if (proposal?.action === 'too_many') {
    // Not answerable by the model: only these two buttons.
    return (
      <Portal>
        <Dialog visible dismissable={false} testID="too-many-questions">
          <Dialog.Title>The model is asking a lot</Dialog.Title>
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
  thinking: {marginTop: 12},
  warning: {color: '#C62828', fontWeight: 'bold', marginBottom: 6},
  actions: {flexWrap: 'wrap'},
});
