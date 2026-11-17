import React, {useCallback, useEffect, useState} from 'react';
import {Alert, StyleSheet, View} from 'react-native';
import {Button, Card, Switch, Text} from 'react-native-paper';

import {TextInput} from '../TextInput';
import {useTheme} from '../../hooks';
import {
  APP_PIN_PATTERN,
  appLockSettings,
  AWAY_MINUTES_CHOICES,
  changeAppLock,
  DEFAULT_AWAY_MINUTES,
  eraseAvailable,
  fingerprintAvailable,
  FORGOT_APP_PIN,
  turnOnAppPin,
  type AppLockChange,
} from '../../services/appLock/appLock';

type Form = 'none' | 'turnOn' | 'change';
type EraseChoice = 'keep' | 'set' | 'remove';

/**
 * Settings → "App PIN" (services/appLock; off by default). Any change once
 * it's on needs the current PIN. The erase PIN is offered only while the
 * app PIN is on, on a device that can erase.
 */
export const AppLockSettings: React.FC<{cardStyle?: object}> = ({
  cardStyle,
}) => {
  const theme = useTheme();
  const [on, setOn] = useState(false);
  const [minutes, setMinutes] = useState(DEFAULT_AWAY_MINUTES);
  const [finger, setFinger] = useState(false);
  const [fingerHere, setFingerHere] = useState(false);
  const [eraseOn, setEraseOn] = useState(false);
  const [form, setForm] = useState<Form>('none');
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [erase, setErase] = useState<EraseChoice>('keep');
  const [erasePin, setErasePin] = useState('');
  const [eraseAgain, setEraseAgain] = useState('');
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);
  const canErase = eraseAvailable();

  const reload = useCallback(async () => {
    const s = await appLockSettings();
    setOn(s.on);
    setMinutes(s.awayMinutes);
    setFinger(s.fingerprint);
    setEraseOn(s.erase);
  }, []);

  useEffect(() => {
    reload();
    fingerprintAvailable().then(setFingerHere);
  }, [reload]);

  const clearForm = () => {
    reload();
    setForm('none');
    setCurrent('');
    setPin('');
    setAgain('');
    setErase('keep');
    setErasePin('');
    setEraseAgain('');
  };

  const digits = (set: (v: string) => void) => (text: string) =>
    set(text.replace(/\D/g, '').slice(0, 16));

  const pinProblem = (a: string, b: string): string | null => {
    if (!APP_PIN_PATTERN.test(a)) {
      return 'A PIN must be 4 to 16 digits.';
    }
    if (a !== b) {
      return "The two PINs don't match.";
    }
    return null;
  };

  const saveTurnOn = async () => {
    const problem = pinProblem(pin, again);
    if (problem) {
      setLine(problem);
      return;
    }
    setBusy(true);
    setLine('Saving…');
    const r = await turnOnAppPin(pin, minutes);
    setBusy(false);
    setLine(r.ok ? 'App PIN on.' : r.error || 'Not saved.');
    if (r.ok) {
      clearForm();
    }
  };

  const saveChange = async (off: boolean) => {
    const change: AppLockChange = off
      ? {off: true}
      : {
          newPin: pin ? pin : undefined,
          awayMinutes: minutes,
          fingerprint: fingerHere ? finger : undefined,
          erasePin:
            erase === 'set' ? erasePin : erase === 'remove' ? null : undefined,
        };
    if (!off && pin) {
      const problem = pinProblem(pin, again);
      if (problem) {
        setLine(problem);
        return;
      }
    }
    if (!off && erase === 'set') {
      const problem = pinProblem(erasePin, eraseAgain);
      if (problem) {
        setLine(`Erase PIN: ${problem}`);
        return;
      }
    }
    setBusy(true);
    setLine('Checking…');
    const r = await changeAppLock(current, change);
    setBusy(false);
    if (!r.ok) {
      setCurrent('');
      setLine(r.message);
      return;
    }
    setLine(off ? 'App PIN off.' : 'Saved.');
    clearForm();
  };

  return (
    <Card elevation={0} style={cardStyle} testID="app-lock-card">
      <Card.Title title="App PIN" />
      <Card.Content>
        <View style={styles.row}>
          <Text variant="bodySmall" style={styles.text}>
            Ask for a PIN when PocketAgent starts, and after it was away (in the
            background, minimised or in the tray) for {minutes} min. Nothing of
            the app shows before it.
          </Text>
          <Switch
            value={on || form === 'turnOn'}
            disabled={busy}
            onValueChange={v => {
              setLine('');
              if (on) {
                // Off (or any change) needs the current PIN.
                if (form === 'change') {
                  clearForm();
                } else {
                  setForm('change');
                }
              } else {
                setForm(v ? 'turnOn' : 'none');
              }
            }}
            testID="app-lock-switch"
          />
        </View>

        {form === 'turnOn' ? (
          <View>
            <TextInput
              testID="app-lock-new"
              label="New PIN (4-16 digits)"
              value={pin}
              onChangeText={digits(setPin)}
              secureTextEntry
              keyboardType="number-pad"
            />
            <TextInput
              testID="app-lock-again"
              label="The same PIN again"
              value={again}
              onChangeText={digits(setAgain)}
              secureTextEntry
              keyboardType="number-pad"
            />
            <Minutes value={minutes} onChange={setMinutes} />
            <Text variant="bodySmall" style={styles.note}>
              If you forget it, the only way back in is to start the app as new,
              without its chats. 5 wrong tries, then a 5-minute wait (longer
              each time).
            </Text>
            <View style={styles.buttons}>
              <Button compact onPress={clearForm}>
                Cancel
              </Button>
              <Button
                compact
                mode="contained"
                disabled={busy}
                onPress={saveTurnOn}
                testID="app-lock-save">
                Turn on
              </Button>
            </View>
          </View>
        ) : null}

        {on && form === 'change' ? (
          <View>
            <TextInput
              testID="app-lock-current"
              label="Current PIN"
              value={current}
              onChangeText={digits(setCurrent)}
              secureTextEntry
              keyboardType="number-pad"
            />
            <TextInput
              testID="app-lock-new"
              label="New PIN (leave empty to keep it)"
              value={pin}
              onChangeText={digits(setPin)}
              secureTextEntry
              keyboardType="number-pad"
            />
            {pin ? (
              <TextInput
                testID="app-lock-again"
                label="The new PIN again"
                value={again}
                onChangeText={digits(setAgain)}
                secureTextEntry
                keyboardType="number-pad"
              />
            ) : null}
            <Minutes value={minutes} onChange={setMinutes} />
            {fingerHere ? (
              <View style={styles.row}>
                <Text variant="bodySmall" style={styles.text}>
                  Fingerprint can unlock it too (the PIN still works). Adding a
                  fingerprint to the phone switches this off.
                </Text>
                <Switch
                  value={finger}
                  onValueChange={setFinger}
                  testID="app-lock-finger"
                />
              </View>
            ) : null}
            {canErase ? (
              <View testID="app-lock-erase">
                <Text variant="titleSmall" style={styles.note}>
                  Erase PIN {eraseOn ? '(set)' : '(not set)'}
                </Text>
                <Text variant="bodySmall" style={styles.note}>
                  A second PIN that, entered where the app PIN is asked, erases
                  everything PocketAgent keeps on this device at once, without
                  asking: chats, memory, assistants, loops, tools, settings,
                  keys, pairings, files, pictures and downloaded models. The app
                  then starts as new. Nothing is sent to your other devices. It
                  must differ from the app PIN.
                </Text>
                <View style={styles.buttons}>
                  <Button
                    compact
                    mode={erase === 'set' ? 'contained' : 'outlined'}
                    onPress={() => setErase(erase === 'set' ? 'keep' : 'set')}
                    testID="app-lock-erase-set">
                    {eraseOn ? 'Change erase PIN' : 'Set erase PIN'}
                  </Button>
                  {eraseOn ? (
                    <Button
                      compact
                      mode={erase === 'remove' ? 'contained' : 'outlined'}
                      onPress={() =>
                        setErase(erase === 'remove' ? 'keep' : 'remove')
                      }
                      testID="app-lock-erase-remove">
                      Remove erase PIN
                    </Button>
                  ) : null}
                </View>
                {erase === 'set' ? (
                  <>
                    <TextInput
                      testID="app-lock-erase-new"
                      label="Erase PIN (4-16 digits)"
                      value={erasePin}
                      onChangeText={digits(setErasePin)}
                      secureTextEntry
                      keyboardType="number-pad"
                    />
                    <TextInput
                      testID="app-lock-erase-again"
                      label="The same erase PIN again"
                      value={eraseAgain}
                      onChangeText={digits(setEraseAgain)}
                      secureTextEntry
                      keyboardType="number-pad"
                    />
                  </>
                ) : null}
              </View>
            ) : null}
            <View style={styles.buttons}>
              <Button
                compact
                onPress={() => Alert.alert('Forgot the PIN?', FORGOT_APP_PIN)}>
                Forgot PIN?
              </Button>
              <Button
                compact
                textColor={theme.colors.error}
                disabled={busy || !current}
                onPress={() => saveChange(true)}
                testID="app-lock-off">
                Turn off
              </Button>
              <Button
                compact
                mode="contained"
                disabled={busy || !current}
                onPress={() => saveChange(false)}
                testID="app-lock-change">
                Save
              </Button>
            </View>
          </View>
        ) : null}

        {on && form === 'none' ? (
          <Button
            compact
            mode="outlined"
            onPress={() => setForm('change')}
            testID="app-lock-edit">
            Change PIN, erase PIN or turn off
          </Button>
        ) : null}
        {line ? (
          <Text variant="bodySmall" testID="app-lock-result">
            {line}
          </Text>
        ) : null}
      </Card.Content>
    </Card>
  );
};

const Minutes: React.FC<{value: number; onChange: (m: number) => void}> = ({
  value,
  onChange,
}) => (
  <View style={styles.minutes}>
    <Text variant="bodySmall">Ask again after the app was away for:</Text>
    <View style={styles.buttons}>
      {AWAY_MINUTES_CHOICES.map(m => (
        <Button
          key={m}
          compact
          mode={m === value ? 'contained' : 'outlined'}
          onPress={() => onChange(m)}
          testID={`app-lock-minutes-${m}`}>
          {m} min
        </Button>
      ))}
    </View>
  </View>
);

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', marginVertical: 6},
  text: {flex: 1, paddingRight: 12},
  note: {marginVertical: 6},
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
    marginVertical: 6,
  },
  minutes: {marginTop: 8},
});
