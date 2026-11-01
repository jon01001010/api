import * as React from 'react';
import {ScrollView, View} from 'react-native';
import {Button, Dialog, Portal, Text} from 'react-native-paper';
import {
  FileProposal, subscribeFileApprovals, decideFileApproval,
} from '../services/talents/fileApprovalGate';

/** Shows the complete proposed content, never a truncated approval summary. */
export function FileApprovalHost(): React.JSX.Element {
  const [proposal, setProposal] = React.useState<FileProposal | null>(null);
  React.useEffect(() => subscribeFileApprovals(setProposal), []);
  return (
    <Portal>
      <Dialog visible={proposal !== null} dismissable={false}>
        <Dialog.Title>Approve file {proposal?.action === 'file_edit' ? 'edit' : 'creation'}?</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium" selectable>{proposal?.filename ?? ''}</Text>
          <Text variant="bodySmall">The model proposes the complete content below. Review it before saving. Original imported files are never overwritten.</Text>
          <ScrollView style={{maxHeight: 320, marginTop: 12}} nestedScrollEnabled>
            <View style={{padding: 8}}>
              <Text variant="labelMedium">Proposed full contents</Text>
              <Text selectable variant="bodySmall">{proposal?.content ?? ''}</Text>
              {proposal?.previous !== undefined && (
                <>
                  <Text variant="labelMedium" style={{marginTop: 12}}>Previous full contents</Text>
                  <Text selectable variant="bodySmall">{proposal.previous}</Text>
                </>
              )}
            </View>
          </ScrollView>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => decideFileApproval(false)}>Deny</Button>
          <Button mode="contained" onPress={() => decideFileApproval(true)}>Approve once</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}
