import * as React from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

import {
  appFingerprintOn,
  FORGOT_APP_PIN,
  loadAppLock,
  tryAppFingerprint,
  tryAppPin,
} from '../../services/appLock/appLock';

/**
 * The app PIN screen (services/appLock). Plain React Native only: it is
 * shown before the app's own code, its stores and its theme are loaded.
 * It says nothing about an erase PIN; every PIN goes through the same
 * check (tryAppPin).
 */
export function AppLockScreen({error}: {error?: boolean}): React.JSX.Element {
  const dark = useColorScheme() === 'dark';
  const c = dark ? colors.dark : colors.light;
  const [pin, setPin] = React.useState('');
  const [message, setMessage] = React.useState(
    error ? "Couldn't read the PIN setting." : '',
  );
  const [busy, setBusy] = React.useState(false);
  const finger = appFingerprintOn();

  const unlock = async () => {
    if (busy || pin.length < 4) {
      return;
    }
    setBusy(true);
    setMessage('Checking…');
    const answer = await tryAppPin(pin);
    setPin('');
    if (!answer.ok) {
      setBusy(false);
      setMessage(answer.message);
    }
  };

  const useFinger = async () => {
    setBusy(true);
    const answer = await tryAppFingerprint();
    if (!answer.ok) {
      setBusy(false);
      setMessage(answer.message);
    }
  };

  const retry = async () => {
    setMessage('');
    if ((await loadAppLock()) === 'error') {
      setMessage("Couldn't read the PIN setting.");
    }
  };

  return (
    <View
      style={[styles.root, {backgroundColor: c.back}]}
      testID="app-lock-screen">
      <Text style={[styles.title, {color: c.text}]}>PocketAgent</Text>
      <Text style={[styles.text, {color: c.text}]}>Enter your PIN</Text>
      {error ? (
        <Button
          label="Try again"
          onPress={retry}
          testID="app-lock-retry"
          c={c}
        />
      ) : (
        <>
          <TextInput
            testID="app-lock-input"
            value={pin}
            onChangeText={t => setPin(t.replace(/\D/g, '').slice(0, 16))}
            secureTextEntry
            keyboardType="number-pad"
            maxLength={16}
            autoFocus
            editable={!busy}
            onSubmitEditing={unlock}
            style={[styles.input, {color: c.text, borderColor: c.line}]}
          />
          <View style={styles.row}>
            {finger ? (
              <Button
                label="Fingerprint"
                onPress={useFinger}
                disabled={busy}
                testID="app-lock-fingerprint"
                c={c}
              />
            ) : null}
            <Button
              label="Unlock"
              main
              onPress={unlock}
              disabled={busy || pin.length < 4}
              testID="app-lock-unlock"
              c={c}
            />
          </View>
        </>
      )}
      {message ? (
        <Text
          style={[styles.message, {color: c.text}]}
          testID="app-lock-message">
          {message}
        </Text>
      ) : null}
      <Pressable
        onPress={() => Alert.alert('Forgot the PIN?', FORGOT_APP_PIN)}
        testID="app-lock-forgot">
        <Text style={[styles.forgot, {color: c.text}]}>Forgot the PIN?</Text>
      </Pressable>
    </View>
  );
}

type Colors = (typeof colors)['light'];

function Button({
  label,
  onPress,
  main,
  disabled,
  testID,
  c,
}: {
  label: string;
  onPress: () => void;
  main?: boolean;
  disabled?: boolean;
  testID: string;
  c: Colors;
}): React.JSX.Element {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={[
        styles.button,
        {borderColor: c.line},
        main && {backgroundColor: c.main},
        disabled && styles.disabled,
      ]}>
      <Text style={[styles.buttonText, {color: main ? c.onMain : c.text}]}>
        {label}
      </Text>
    </Pressable>
  );
}

const colors = {
  light: {
    back: '#ffffff',
    text: '#111111',
    line: '#888888',
    main: '#222222',
    onMain: '#ffffff',
  },
  dark: {
    back: '#000000',
    text: '#eeeeee',
    line: '#777777',
    main: '#dddddd',
    onMain: '#000000',
  },
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {fontSize: 22, marginBottom: 8},
  text: {fontSize: 15, marginBottom: 16},
  input: {
    width: 220,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 20,
    textAlign: 'center',
    letterSpacing: 4,
  },
  row: {flexDirection: 'row', gap: 10, marginTop: 16},
  button: {
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  buttonText: {fontSize: 15},
  disabled: {opacity: 0.5},
  message: {marginTop: 16, maxWidth: 320, textAlign: 'center'},
  forgot: {marginTop: 28, fontSize: 13, textDecorationLine: 'underline'},
});
