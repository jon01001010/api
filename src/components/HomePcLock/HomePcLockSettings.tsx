import React, {useCallback, useEffect, useState} from 'react';
import {Alert, StyleSheet, View} from 'react-native';
import {Button, Switch, Text} from 'react-native-paper';

import {TextInput} from '../TextInput';
import {useTheme} from '../../hooks';
import {
  AWAY_MINUTES_CHOICES,
  changeLock,
  DEFAULT_AWAY_MINUTES,
  fingerprintAvailable,
  FORGOT_PIN,
  homePcLockSettings,
  PIN_PATTERN,
  turnOnPin,
} from '../../services/homeLink/homePcLock';

type Form = 'none' | 'turnOn' | 'change';

/**
 * A paired Home PC's server sheet: "Ask for a PIN before using this PC"
 * (this device only; off by default). Any change once it's on needs the
 * current PIN.
 */
export const HomePcLockSettings: React.FC<{pc: string}> = ({pc}) => {
  const theme = useTheme();
  const [on, setOn] = useState(false);
  const [minutes, setMinutes] = useState(DEFAULT_AWAY_MINUTES);
  const [finger, setFinger] = useState(false);
  const [fingerHere, setFingerHere] = useState(false);
  const [form, setForm] = useState<Form>('none');
  const [current, setCurrent] = useState('');
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [line, setLine] = useState('');
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const s = await homePcLockSettings(pc);
    setOn(s.on);
    setMinutes(s.awayMinutes);
    setFinger(s.fingerprint);
  }, [pc]);

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
  };

  const digits = (set: (v: string) => void) => (text: string) =>
    set(text.replace(/\D/g, '').slice(0, 8));

  const newPinProblem = (): string | null => {
    if (!PIN_PATTERN.test(pin)) {
      return 'The PIN must be 4 to 8 digits.';
    }
    if (pin !== again) {
      return "The two PINs don't match.";
    }
    return null;
  };

  const saveTurnOn = async () => {
    const problem = newPinProblem();
    if (problem) {
      setLine(problem);
      return;
    }
    setBusy(true);
    setLine('Saving…');
    const r = await turnOnPin(pc, pin, minutes);
    setBusy(false);
    setLine(r.ok ? 'PIN on for this PC.' : r.error || 'Not saved.');
    if (r.ok) {
      clearForm();
      reload();
    }
  };

  const saveChange = async (change: {
    off?: boolean;
    newPin?: string;
    awayMinutes?: number;
    fingerprint?: boolean;
  }) => {
    if (change.newPin !== undefined) {
      const problem = newPinProblem();
      if (problem) {
        setLine(problem);
        return;
      }
    }
    setBusy(true);
    setLine('Checking…');
    const r = await changeLock(pc, current, change);
    setBusy(false);
    if (!r.ok) {
      setCurrent('');
      setLine(r.message);
      return;
    }
    setLine(change.off ? 'PIN off for this PC.' : 'Saved.');
    clearForm();
    reload();
  };

  return (
    <View testID="home-pc-lock">
      <View style={styles.row}>
        <Text variant="bodySmall" style={styles.text}>
          Ask for a PIN before using this PC from this device (after the app was
          in the background for {minutes} min, and after a restart). It keeps
          someone holding this phone unlocked from using your PC. It doesn't
          protect what's already on this phone (chats, memory).
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
          testID="home-pc-lock-switch"
        />
      </View>

      {form === 'turnOn' ? (
        <View>
          <TextInput
            testID="home-pc-lock-new"
            label="New PIN (4-8 digits)"
            value={pin}
            onChangeText={digits(setPin)}
            secureTextEntry
            keyboardType="number-pad"
          />
          <TextInput
            testID="home-pc-lock-again"
            label="The same PIN again"
            value={again}
            onChangeText={digits(setAgain)}
            secureTextEntry
            keyboardType="number-pad"
          />
          <Minutes value={minutes} onChange={setMinutes} />
          <Text variant="bodySmall" style={styles.note}>
            If you forget it, the only way back is to pair this device again,
            which your PC must approve. 5 wrong tries, then a 5-minute wait
            (longer each time).
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
              testID="home-pc-lock-save">
              Turn on
            </Button>
          </View>
        </View>
      ) : null}

      {on && form === 'change' ? (
        <View>
          <TextInput
            testID="home-pc-lock-current"
            label="Current PIN"
            value={current}
            onChangeText={digits(setCurrent)}
            secureTextEntry
            keyboardType="number-pad"
          />
          <TextInput
            testID="home-pc-lock-new"
            label="New PIN (leave empty to keep it)"
            value={pin}
            onChangeText={digits(setPin)}
            secureTextEntry
            keyboardType="number-pad"
          />
          {pin ? (
            <TextInput
              testID="home-pc-lock-again"
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
                testID="home-pc-lock-finger"
              />
            </View>
          ) : null}
          <View style={styles.buttons}>
            <Button
              compact
              onPress={() => Alert.alert('Forgot the PIN?', FORGOT_PIN)}>
              Forgot PIN?
            </Button>
            <Button
              compact
              textColor={theme.colors.error}
              disabled={busy || !current}
              onPress={() => saveChange({off: true})}
              testID="home-pc-lock-off">
              Turn off
            </Button>
            <Button
              compact
              mode="contained"
              disabled={busy || !current}
              onPress={() =>
                saveChange({
                  newPin: pin ? pin : undefined,
                  awayMinutes: minutes,
                  fingerprint: fingerHere ? finger : undefined,
                })
              }
              testID="home-pc-lock-change">
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
          testID="home-pc-lock-edit">
          Change PIN or turn off
        </Button>
      ) : null}
      {line ? (
        <Text variant="bodySmall" testID="home-pc-lock-result">
          {line}
        </Text>
      ) : null}
    </View>
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
          testID={`home-pc-lock-minutes-${m}`}>
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
