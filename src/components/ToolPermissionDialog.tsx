import React, {useEffect, useState} from 'react';
import {Button, Dialog, Portal, Text} from 'react-native-paper';
import {PendingPermission, permissionRequests} from '../services/security/permissionRequests';

/** Mount once at app root, outside screens that may unmount during inference. */
export const ToolPermissionDialog: React.FC = () => {
  const [pending, setPending] = useState<PendingPermission | null>(null);
  useEffect(() => {
    const unsubscribe = permissionRequests.subscribe(setPending);
    return () => {unsubscribe(); permissionRequests.cancel();};
  }, []);
  return (
    <Portal>
      <Dialog visible={pending !== null} onDismiss={() => pending && permissionRequests.respond(pending.id, 'deny')}>
        <Dialog.Title>Allow tool action?</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium">{pending?.tool} requests {pending?.capability} access.</Text>
          <Text variant="bodySmall">{pending?.description}</Text>
        </Dialog.Content>
        <Dialog.Actions>
          <Button onPress={() => pending && permissionRequests.respond(pending.id, 'deny')}>Deny</Button>
          <Button onPress={() => pending && permissionRequests.respond(pending.id, 'allow_once')}>Once</Button>
          <Button onPress={() => pending && permissionRequests.respond(pending.id, 'allow_always')}>Always</Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
};
