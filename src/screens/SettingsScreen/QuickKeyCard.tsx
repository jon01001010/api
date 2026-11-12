import React, {useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Card, Switch, Text} from 'react-native-paper';

/** Saved choice (this PC only). Read at start-up by web/start.js. */
export const QUICK_KEY_SETTING = 'pa-quick-key';

const tauri = () =>
  (globalThis as any).__TAURI_INTERNALS__ as
    | {invoke: (cmd: string, args?: object) => Promise<unknown>}
    | undefined;

const saved = () => {
  try {
    return globalThis.localStorage?.getItem(QUICK_KEY_SETTING) === 'on';
  } catch {
    return false;
  }
};

/**
 * Desktop app only: Ctrl+Shift+Space brings DesktopAgent to the front from
 * any program (src-tauri/src/pc_extra.rs). Off until switched on.
 */
export const QuickKeyCard: React.FC<{cardStyle?: object}> = ({cardStyle}) => {
  const [on, setOn] = useState(saved);
  const [note, setNote] = useState('');
  const t = tauri();
  if (!t) {
    return null;
  }
  const change = async (value: boolean) => {
    try {
      await t.invoke('quick_key_set', {enabled: value});
      globalThis.localStorage?.setItem(QUICK_KEY_SETTING, value ? 'on' : 'off');
      setOn(value);
      setNote('');
    } catch (e) {
      setNote(String(e));
    }
  };
  return (
    <Card elevation={0} style={cardStyle} testID="quick-key-card">
      <Card.Title title="Quick chat key" />
      <Card.Content>
        <View style={styles.row}>
          <Text variant="bodySmall" style={styles.text}>
            Ctrl+Shift+Space brings DesktopAgent to the front from any program.
            The tray icon by the clock opens it too.
          </Text>
          <Switch value={on} onValueChange={change} testID="quick-key-switch" />
        </View>
        {note ? <Text variant="bodySmall">{note}</Text> : null}
      </Card.Content>
    </Card>
  );
};

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center'},
  text: {flex: 1, paddingRight: 12},
});
