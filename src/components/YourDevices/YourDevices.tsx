import React, {useState} from 'react';
import {Alert, StyleSheet, View} from 'react-native';
import {Button, Card, Text} from 'react-native-paper';
import {observer} from 'mobx-react';

import {serverStore} from '../../store';
import type {LinkKeyMode, LinkPhone} from '../../services/desktop/homeLink';
import {
  describeDirection,
  describePaired,
  describeRights,
  listYourDevices,
  removeQuestion,
  shortKey,
  YourDevice,
} from '../../services/homeLink/yourDevices';

interface Props {
  /** Devices that use this PC (desktop only; the phone hosts nothing). */
  phones?: LinkPhone[];
  /** Removes a device that uses this PC (link_forget), on this PC only. */
  onForget?: (id: string) => Promise<void>;
  /** This PC's switches for one device's rights (each asked on this PC). */
  renderRights?: (phone: LinkPhone) => React.ReactNode;
  /** Desktop only: which keys this PC uses, and the move to one key. */
  keyMode?: LinkKeyMode | null;
  onUseOneKey?: () => Promise<void>;
  busy?: boolean;
}

/**
 * "Your devices" (device-circle stage 1): every device this one is paired
 * with, either way, with what this device has given it. Removing works as
 * before and on this device only (telling the others comes later).
 */
export const YourDevices: React.FC<Props> = observer(
  ({phones = [], onForget, renderRights, keyMode, onUseOneKey, busy}) => {
    const devices = listYourDevices(phones, serverStore.servers);
    const [message, setMessage] = useState('');

    const remove = (device: YourDevice) => {
      Alert.alert(`Remove "${device.name}"?`, removeQuestion(device), [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove here',
          style: 'destructive',
          onPress: async () => {
            try {
              if (device.usesThis && onForget) {
                await onForget(device.key);
              }
              device.serverIds.forEach(id => serverStore.removeServer(id));
              setMessage(
                `Removed "${device.name}" here. Remove this device on it too.`,
              );
            } catch (e) {
              setMessage(String(e));
            }
          },
        },
      ]);
    };

    const useOneKey = () => {
      const pcs = devices.filter(d => d.thisUses).map(d => `"${d.name}"`);
      Alert.alert(
        'Use one key for this PC?',
        [
          'This PC then uses the same key as a device of other PCs as the one its own devices paired with, so every device knows it by one key.',
          pcs.length
            ? `The PCs this PC uses (${pcs.join(', ')}) will no longer know it: pair with each one again by hand (a new code from that PC; it asks there), then remove this PC's old entry there.`
            : 'This PC uses no other PC yet, so nothing needs pairing again.',
          'Devices that use this PC are not affected. Nothing moves by itself; the old key is kept, unused.',
        ].join('\n\n'),
        [
          {text: 'Cancel', style: 'cancel'},
          {
            text: 'Use one key',
            onPress: async () => {
              try {
                await onUseOneKey?.();
                setMessage(
                  pcs.length
                    ? 'This PC now uses one key. Pair again with each PC it uses.'
                    : 'This PC now uses one key.',
                );
              } catch (e) {
                setMessage(String(e));
              }
            },
          },
        ],
      );
    };

    return (
      <View testID="your-devices">
        <Text variant="labelMedium" style={styles.title}>
          Your devices
        </Text>
        {devices.length === 0 ? (
          <Text variant="bodySmall">No paired devices yet.</Text>
        ) : null}
        {devices.map(device => (
          <View
            key={device.key}
            style={styles.device}
            testID={`your-devices-${device.key}`}>
            <Text variant="bodyMedium">
              {device.name} · {shortKey(device.key)}
            </Text>
            <Text variant="bodySmall">
              {describeDirection(device)} · {describePaired(device)}
            </Text>
            <Text
              variant="bodySmall"
              testID={`your-devices-rights-${device.key}`}>
              {describeRights(device)}
            </Text>
            {device.phone && renderRights ? renderRights(device.phone) : null}
            <Button
              compact
              mode="text"
              disabled={busy}
              style={styles.remove}
              testID={`your-devices-remove-${device.key}`}
              onPress={() => remove(device)}>
              Remove here
            </Button>
          </View>
        ))}
        {devices.length > 0 ? (
          <Text variant="bodySmall" style={styles.note}>
            Rights are given per device, on the device that gives them. Removing
            a device here does not remove it on your other devices yet.
          </Text>
        ) : null}
        {keyMode ? (
          <View testID="your-devices-key-mode">
            <Text variant="bodySmall" style={styles.note}>
              {keyMode.oneKey
                ? `This PC uses one key: ${shortKey(keyMode.linkKey)}`
                : `This PC uses two keys: ${shortKey(keyMode.linkKey)} for devices that use it, ${shortKey(keyMode.deviceKey)} as a device of other PCs.`}
            </Text>
            {!keyMode.oneKey && onUseOneKey ? (
              <Button
                compact
                disabled={busy}
                testID="your-devices-use-one-key"
                onPress={useOneKey}>
                Use one key for this PC
              </Button>
            ) : null}
          </View>
        ) : null}
        {message ? (
          <Text variant="bodySmall" testID="your-devices-message">
            {message}
          </Text>
        ) : null}
      </View>
    );
  },
);

/** The phone's card: the PCs it uses (it hosts nothing). */
export const YourDevicesCard: React.FC<{cardStyle?: object}> = ({
  cardStyle,
}) => (
  <Card elevation={0} style={cardStyle} testID="your-devices-card">
    <Card.Content>
      <YourDevices />
    </Card.Content>
  </Card>
);

const styles = StyleSheet.create({
  title: {marginVertical: 8},
  device: {marginBottom: 10},
  remove: {alignSelf: 'flex-start'},
  note: {marginTop: 6},
});
