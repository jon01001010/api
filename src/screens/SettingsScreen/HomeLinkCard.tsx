import Clipboard from '@react-native-clipboard/clipboard';
import React, {useCallback, useEffect, useState} from 'react';
import {Image, StyleSheet, View} from 'react-native';
import {Button, Card, Switch, Text} from 'react-native-paper';

import {RecentlyDeletedAssistants} from '../../components/HomeLinkSync/RecentlyDeletedAssistants';
import {RecentlyDeletedLoops} from '../../components/HomeLinkSync/RecentlyDeletedLoops';
import {RecentlyDeletedChats} from '../../components/HomeLinkSync/RecentlyDeletedChats';
import {describeEvent} from '../../services/homeLink/homeLink';
import {
  hostAnswersAllowed,
  hostMirrorAllowed,
  hostSyncAllowed,
  setHostAnswersAllowed,
  setHostMirrorAllowed,
  setHostSyncAllowed,
} from '../../services/sync/hostSync';
import {
  homeLinkAvailable,
  linkDeviceMayAnswer,
  linkDeviceMayPicture,
  linkDeviceMayRead,
  linkForget,
  linkOff,
  linkOn,
  linkPair,
  linkPicturesAllow,
  linkToolsAllow,
  linkStatus,
  LinkPairing,
  LinkStatus,
} from '../../services/desktop/homeLink';

/**
 * Desktop app only: "Use this PC's model from your phone". Pair a phone with
 * a QR code; afterwards it can use the model running here from anywhere.
 * Shows nothing on the phone.
 */
export const HomeLinkCard: React.FC<{cardStyle?: object}> = ({cardStyle}) => {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [pairing, setPairing] = useState<LinkPairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [syncAllowed, setSyncAllowed] = useState(false);
  const [mirrorAllowed, setMirrorAllowed] = useState(false);
  const [answersAllowed, setAnswersAllowed] = useState(false);
  useEffect(() => {
    hostSyncAllowed().then(setSyncAllowed);
    hostMirrorAllowed().then(setMirrorAllowed);
    hostAnswersAllowed().then(setAnswersAllowed);
  }, []);

  const refresh = useCallback(() => {
    linkStatus()
      .then(next => {
        setStatus(prev => {
          // A phone just paired: the one-time code is used up, hide it.
          if (prev && next.phones.length > prev.phones.length) {
            setPairing(null);
          }
          return next;
        });
      })
      .catch(() => setStatus(null));
  }, []);
  useEffect(() => {
    if (homeLinkAvailable()) {
      refresh();
    }
  }, [refresh]);
  // While a QR code is shown, check now and then for a newly paired phone.
  useEffect(() => {
    if (!pairing) {
      return;
    }
    const timer = setInterval(refresh, 3000);
    const expire = setTimeout(
      () => setPairing(null),
      pairing.expiresInSecs * 1000,
    );
    return () => {
      clearInterval(timer);
      clearTimeout(expire);
    };
  }, [pairing, refresh]);

  if (!homeLinkAvailable() || !status) {
    return null;
  }
  const run = async (what: () => Promise<unknown>) => {
    setBusy(true);
    setMessage('');
    try {
      await what();
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  return (
    <Card elevation={0} style={cardStyle} testID="home-link-card">
      <Card.Title title="Use this PC's model from your phone" />
      <Card.Content>
        <Text variant="bodySmall">
          PocketAgent on your phone can use the model running here, from
          anywhere: home Wi-Fi, mobile data, anywhere. Encrypted from this PC to
          the phone; when no direct path is found, a relay passes it on without
          being able to read it. Only phones you pair get in, and only to the
          model: not your files or anything else on this PC.
        </Text>
        <Text variant="bodySmall" style={styles.state} testID="home-link-state">
          {status.on ? 'On' : 'Off'}
          {status.on && status.pcId
            ? ` · this PC's key ${status.pcId.slice(0, 10)}…`
            : ''}
        </Text>
        <Button
          mode="contained"
          disabled={busy}
          testID="home-link-pair"
          onPress={() => run(async () => setPairing(await linkPair()))}>
          Pair a phone or PC
        </Button>
        {pairing ? (
          <View style={styles.qrBox} testID="home-link-qr">
            <Image
              source={{uri: pairing.qrImage}}
              style={styles.qr}
              accessibilityLabel="Pairing QR code"
            />
            <Text variant="bodySmall">
              Scan with PocketAgent on your phone. This code works once, for{' '}
              {Math.round(pairing.expiresInSecs / 60)} minutes; this PC asks you
              before pairing.
            </Text>
            {/* Another PC (no camera): copy the code and paste it into its
                DesktopAgent (Models → add a server, address box). */}
            <Text
              variant="bodySmall"
              selectable
              style={styles.code}
              testID="home-link-code">
              {pairing.qr}
            </Text>
            <Button
              compact
              testID="home-link-copy-code"
              onPress={() => Clipboard.setString(pairing.qr)}>
              Copy the code (for another PC)
            </Button>
          </View>
        ) : null}
        <Button
          disabled={busy}
          testID="home-link-toggle"
          onPress={() =>
            run(async () => {
              setPairing(null);
              await (status.on ? linkOff() : linkOn());
            })
          }>
          {status.on ? 'Switch off' : 'Switch on'}
        </Button>
        <View style={styles.syncRow}>
          <Text variant="bodySmall" style={styles.syncText}>
            Let paired devices keep the system prompt, memory, assistants,
            custom tools and loops in step with this PC (the newer edit wins;
            the other is kept in history). A loop from a device arrives paused:
            start it here under Toolbox → Loops. Toolbox switches stay per
            device. Each device must switch it on too.
          </Text>
          <Switch
            value={syncAllowed}
            testID="home-link-sync-allow"
            onValueChange={v =>
              run(async () => {
                await setHostSyncAllowed(v);
                setSyncAllowed(v);
              })
            }
          />
        </View>
        {syncAllowed ? (
          <View style={styles.syncRow}>
            <Text variant="bodySmall" style={styles.syncText}>
              Mirror chats with paired devices too (each device must switch it
              on as well). Deleting a chat on one deletes it on the other
              (unless changed there since); it is kept 30 days under Recently
              deleted.
            </Text>
            <Switch
              value={mirrorAllowed}
              testID="home-link-mirror-allow"
              onValueChange={v =>
                run(async () => {
                  await setHostMirrorAllowed(v);
                  setMirrorAllowed(v);
                })
              }
            />
          </View>
        ) : null}
        {syncAllowed && mirrorAllowed ? <RecentlyDeletedChats /> : null}
        {syncAllowed ? <RecentlyDeletedAssistants /> : null}
        {syncAllowed ? <RecentlyDeletedLoops /> : null}
        <View style={styles.syncRow}>
          <Text variant="bodySmall" style={styles.syncText}>
            Let paired devices answer this PC's "Allow?" questions too: they see
            the same words and can allow once or refuse; the first answer wins.
            Pairing a new device is only asked here. Only devices you allow
            below (each asked here), and each device must switch it on too.
          </Text>
          <Switch
            value={answersAllowed}
            testID="home-link-answers-allow"
            onValueChange={v =>
              run(async () => {
                await setHostAnswersAllowed(v);
                setAnswersAllowed(v);
              })
            }
          />
        </View>
        <View style={styles.syncRow}>
          <Text variant="bodySmall" style={styles.syncText}>
            Let paired devices make pictures on this PC: they send a
            description, this PC makes the picture with its own picture model
            (same limits and word check as here, one at a time; a copy stays in
            the workspace's images folder) and shows a notification. Only
            devices you allow below (each asked here).
          </Text>
          <Switch
            value={!!status.picturesAllowed}
            testID="home-link-pictures-allow"
            onValueChange={v => run(() => linkPicturesAllow(v))}
          />
        </View>
        <View style={styles.syncRow}>
          <Text variant="bodySmall" style={styles.syncText}>
            Let paired devices use this PC's tools: this PC's information, and
            the list and text of the files in its workspace (read only; reading
            asks here once per chat, and this PC shows a notification for each
            file read). Only devices you allow below (each asked here).
          </Text>
          <Switch
            value={!!status.toolsAllowed}
            testID="home-link-tools-allow"
            onValueChange={v => run(() => linkToolsAllow(v))}
          />
        </View>
        {status.phones.length > 0 ? (
          <Text variant="labelMedium" style={styles.state}>
            Paired phones
          </Text>
        ) : null}
        {status.phones.map(phone => (
          <View key={phone.id} style={styles.phone}>
            <Text variant="bodySmall" style={styles.phoneName}>
              {phone.name} · {phone.id.slice(0, 10)}…
            </Text>
            {answersAllowed ? (
              <>
                <Text variant="bodySmall">May answer</Text>
                <Switch
                  value={!!phone.mayAnswer}
                  disabled={busy}
                  accessibilityLabel={`${phone.name} may answer this PC's questions`}
                  testID={`home-link-may-answer-${phone.id}`}
                  onValueChange={v =>
                    run(() => linkDeviceMayAnswer(phone.id, v))
                  }
                />
              </>
            ) : null}
            {status.picturesAllowed ? (
              <>
                <Text variant="bodySmall">Pictures</Text>
                <Switch
                  value={!!phone.mayPicture}
                  disabled={busy}
                  accessibilityLabel={`${phone.name} may make pictures on this PC`}
                  testID={`home-link-may-picture-${phone.id}`}
                  onValueChange={v =>
                    run(() => linkDeviceMayPicture(phone.id, v))
                  }
                />
              </>
            ) : null}
            {status.toolsAllowed ? (
              <>
                <Text variant="bodySmall">May read</Text>
                <Switch
                  value={!!phone.mayRead}
                  disabled={busy}
                  accessibilityLabel={`${phone.name} may use this PC's tools`}
                  testID={`home-link-may-read-${phone.id}`}
                  onValueChange={v => run(() => linkDeviceMayRead(phone.id, v))}
                />
              </>
            ) : null}
            <Button
              compact
              disabled={busy}
              testID={`home-link-forget-${phone.id}`}
              onPress={() => run(() => linkForget(phone.id))}>
              Remove
            </Button>
          </View>
        ))}
        {status.events && status.events.length > 0 ? (
          <>
            <Text variant="labelMedium" style={styles.state}>
              Pairing history (your paired phones see this too)
            </Text>
            {[...status.events]
              .reverse()
              .slice(0, 5)
              .map(e => (
                <Text key={e.n} variant="bodySmall" testID="home-link-event">
                  {describeEvent(e)}
                </Text>
              ))}
          </>
        ) : null}
        {message ? <Text variant="bodySmall">{message}</Text> : null}
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  state: {marginVertical: 8},
  qrBox: {alignItems: 'center', marginVertical: 12},
  qr: {width: 240, height: 240, marginBottom: 8, backgroundColor: '#ffffff'},
  code: {marginTop: 6, fontFamily: 'monospace', fontSize: 10},
  syncRow: {flexDirection: 'row', alignItems: 'center', marginVertical: 6},
  syncText: {flex: 1, paddingRight: 12},
  phone: {flexDirection: 'row', alignItems: 'center'},
  phoneName: {flex: 1},
});
