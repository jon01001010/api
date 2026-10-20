import React from 'react';
import {Platform, PermissionsAndroid} from 'react-native';
import {ensureNotificationPermission} from '../../utils/androidPermission';
import {Button, Card, Text} from 'react-native-paper';
import {
  startLocalApi,
  stopLocalApi,
  getLocalApiSession,
  subscribeLocalApi,
} from '../../services/localApi/service';

export const LocalApiCard = () => {
  const [session, setSession] = React.useState(getLocalApiSession);
  const [visible, setVisible] = React.useState(false);
  const [error, setError] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  React.useEffect(
    () =>
      subscribeLocalApi(() => {
        setSession(getLocalApiSession());
        setVisible(false);
      }),
    [],
  );
  if (Platform.OS !== 'android') {
    return null;
  }
  return (
    <Card>
      <Card.Title title="Share local model · experimental" />
      <Card.Content>
        <Text>
          Local, text-only API for compatible apps. Hexagon must be selected;
          NPU performance is not yet verified on your phone. Stop revokes the
          session key.
        </Text>
        <Text>
          Anyone with the key can use the loaded model. Saved chats and files
          are not exposed. No LAN access.
        </Text>
        {session ? (
          <>
            <Text selectable>{session.url}</Text>
            <Button onPress={() => setVisible(!visible)}>
              {visible ? 'Hide key' : 'Show session key'}
            </Button>
            {visible ? <Text selectable>{session.token}</Text> : null}
          </>
        ) : null}
        {error ? <Text>{error}</Text> : null}
        <Button
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setError('');
            try {
              if (session) {
                await stopLocalApi();
                setSession(null);
                setVisible(false);
              } else {
                await ensureNotificationPermission();
                if (
                  Number(Platform.Version) >= 33 &&
                  !(await PermissionsAndroid.check(
                    PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
                  ))
                ) {
                  throw new Error(
                    'Allow notifications so the running service and Stop action stay visible.',
                  );
                }
                setSession(await startLocalApi());
              }
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Service failed');
            } finally {
              setBusy(false);
            }
          }}>
          {session ? 'Stop sharing' : 'Start sharing'}
        </Button>
      </Card.Content>
    </Card>
  );
};
