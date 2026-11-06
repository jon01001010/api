import * as React from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {Button, Dialog, Portal, Text} from 'react-native-paper';
import {
  FileProposal,
  subscribeFileApprovals,
  decideFileApproval,
} from '../services/talents/fileApprovalGate';

const ACTION_LABEL: Record<FileProposal['action'], string> = {
  file_create: 'creation',
  file_edit: 'edit',
  file_append: 'append',
  file_patch: 'patch',
  file_undo: 'undo',
  phone_action: 'phone action',
  custom_tool: 'custom tool',
};

/** Shows the line changes and the complete proposed content, never a truncated approval summary. */
export function FileApprovalHost(): React.JSX.Element {
  const [proposal, setProposal] = React.useState<FileProposal | null>(null);
  React.useEffect(() => subscribeFileApprovals(setProposal), []);
  return (
    <Portal>
      {proposal?.action === 'phone_action' ||
      proposal?.action === 'custom_tool' ? (
        <Dialog visible dismissable={false} testID="phone-action-approval">
          <Dialog.Title>
            {proposal.action === 'custom_tool'
              ? 'Save this tool?'
              : 'Allow this on your phone?'}
          </Dialog.Title>
          <Dialog.Content>
            <Text variant="bodyLarge" selectable>
              {proposal.filename}
            </Text>
            {!!proposal.content && (
              <Text variant="bodySmall" selectable style={{marginTop: 8}}>
                {proposal.content}
              </Text>
            )}
          </Dialog.Content>
          <Dialog.Actions>
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
              </View>
            </ScrollView>
          </Dialog.Content>
          <Dialog.Actions>
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
});
