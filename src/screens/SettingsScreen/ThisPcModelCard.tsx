import React, {useState} from 'react';
import {StyleSheet} from 'react-native';
import {Button, Card, Text} from 'react-native-paper';

import {
  isDesktopApp,
  runModelOnThisPc,
  stopModelOnThisPc,
} from '../../services/desktop/thisPc';

/**
 * Windows app only: run a .gguf model on this PC with the bundled llama.cpp
 * server. Shows nothing on the phone.
 */
export const ThisPcModelCard: React.FC<{cardStyle?: object}> = ({
  cardStyle,
}) => {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  if (!isDesktopApp()) {
    return null;
  }
  const run = async () => {
    setBusy(true);
    setMessage('Starting… (big models take a while to load)');
    try {
      setMessage((await runModelOnThisPc()).message);
    } catch (e) {
      setMessage(String(e));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    await stopModelOnThisPc();
    setMessage('Stopped.');
  };
  return (
    <Card elevation={0} style={cardStyle} testID="this-pc-model-card">
      <Card.Title title="Run a model on this PC" />
      <Card.Content>
        <Text variant="bodySmall">
          Pick a .gguf model file. It runs on this PC only, with a private
          password, and shows up as the server "This PC" in Models.
        </Text>
        <Button
          mode="contained"
          onPress={run}
          disabled={busy}
          loading={busy}
          testID="this-pc-model-run"
          style={styles.run}>
          Choose a model and run it
        </Button>
        <Button onPress={stop} disabled={busy} testID="this-pc-model-stop">
          Stop the model
        </Button>
        {message ? <Text variant="bodySmall">{message}</Text> : null}
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({run: {marginTop: 8}});
