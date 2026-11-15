import * as React from 'react';
import {Alert, StyleSheet} from 'react-native';
import {Button, Dialog, Portal, Text, TextInput} from 'react-native-paper';

import {
  cancelPinRequest,
  FORGOT_PIN,
  PinRequest,
  subscribePinRequests,
  tryFingerprint,
  tryPin,
} from '../../services/homeLink/homePcLock';

/**
 * The PIN window for a locked Home PC (services/homeLink/homePcLock). Shown
 * when something the user does needs the PC; Cancel refuses that use.
 */
export function HomePcPinPrompt(): React.JSX.Element {
  const [request, setRequest] = React.useState<PinRequest | null>(null);
  const [pin, setPin] = React.useState('');
  const [message, setMessage] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  React.useEffect(
    () =>
      subscribePinRequests(next => {
        setRequest(before => {
          if (before?.pc !== next?.pc) {
            setPin('');
            setMessage('');
            setBusy(false);
          }
          return next;
        });
      }),
    [],
  );

  if (!request) {
    return <Portal>{null}</Portal>;
  }
  const pc = request.pc;

  const unlock = async () => {
    if (busy || !pin) {
      return;
    }
    setBusy(true);
    setMessage('Checking…');
    const answer = await tryPin(pc, pin);
    if (!answer.ok) {
      setBusy(false);
      setPin('');
      setMessage(answer.message);
    }
  };

  const finger = async () => {
    setBusy(true);
    const answer = await tryFingerprint(pc);
    if (!answer.ok) {
      setBusy(false);
      setMessage(answer.message);
    }
  };

  return (
    <Portal>
      <Dialog
        visible
        dismissable={false}
        onDismiss={() => cancelPinRequest(pc)}
        testID="home-pc-pin-prompt">
        <Dialog.Title>Unlock your Home PC</Dialog.Title>
        <Dialog.Content>
          <Text variant="bodyMedium">
            Enter the PIN you set for this PC on this device.
          </Text>
          <TextInput
            testID="home-pc-pin-input"
            value={pin}
            onChangeText={text => setPin(text.replace(/\D/g, '').slice(0, 8))}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={8}
            autoFocus
            disabled={busy}
            onSubmitEditing={unlock}
            style={styles.input}
          />
          {message ? (
            <Text
              variant="bodySmall"
              style={styles.message}
              testID="home-pc-pin-message">
              {message}
            </Text>
          ) : null}
        </Dialog.Content>
        <Dialog.Actions style={styles.actions}>
          <Button
            compact
            onPress={() => Alert.alert('Forgot the PIN?', FORGOT_PIN)}
            testID="home-pc-pin-forgot">
            Forgot PIN?
          </Button>
          {request.fingerprint ? (
            <Button
              compact
              disabled={busy}
              onPress={finger}
              testID="home-pc-pin-fingerprint">
              Fingerprint
            </Button>
          ) : null}
          <Button
            compact
            onPress={() => cancelPinRequest(pc)}
            testID="home-pc-pin-cancel">
            Cancel
          </Button>
          <Button
            compact
            mode="contained"
            disabled={busy || pin.length < 4}
            onPress={unlock}
            testID="home-pc-pin-unlock">
            Unlock
          </Button>
        </Dialog.Actions>
      </Dialog>
    </Portal>
  );
}

const styles = StyleSheet.create({
  input: {marginTop: 12},
  message: {marginTop: 8},
  actions: {flexWrap: 'wrap'},
});
