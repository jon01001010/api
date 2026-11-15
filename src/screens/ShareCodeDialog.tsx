/**
 * Shares a PocketAgent code (a tool `PA1:T:` or a loop `PA1:L:`): a QR when
 * it fits in one, Copy code, and Share as file. Only shows and hands out
 * the code; it never reads or runs anything.
 */
import React, {useState} from 'react';
import {ScrollView, View} from 'react-native';
import {Button, Dialog, Text} from 'react-native-paper';
import Clipboard from '@react-native-clipboard/clipboard';
import * as RNFS from '@dr.pogodin/react-native-fs';
import Share from 'react-native-share';

import {QrCodeView} from '../components/QrCodeView';
import {QR_MAX_CHARS, fitsOneQr} from '../services/talents/toolQr';

export const ShareCodeDialog: React.FC<{
  visible: boolean;
  title: string;
  code: string;
  /** The file's name when shared as a file. */
  filename: string;
  /** "tool" or "loop", for the plain messages. */
  what: string;
  /** What the other device does with it. */
  hint: string;
  /** testID prefix, e.g. "tool-share". */
  testPrefix: string;
  onDismiss: () => void;
}> = ({visible, title, code, filename, what, hint, testPrefix, onDismiss}) => {
  const [note, setNote] = useState('');
  const fits = !!code && fitsOneQr(code);

  const copy = () => {
    Clipboard.setString(code);
    setNote('Code copied. Paste it in Toolbox → Scan or paste a code.');
  };

  const shareFile = async () => {
    if (!code) {
      return;
    }
    try {
      const path = RNFS.CachesDirectoryPath + '/' + filename;
      if (await RNFS.exists(path)) {
        await RNFS.unlink(path);
      }
      await RNFS.writeFile(path, code, 'utf8');
      await Share.open({
        url: 'file://' + path,
        filename,
        title,
        type: 'text/plain',
        failOnCancel: false,
      });
    } catch (e) {
      setNote(
        'Could not share the file: ' + String((e as Error)?.message ?? e),
      );
    }
  };

  const close = () => {
    setNote('');
    onDismiss();
  };

  return (
    <Dialog visible={visible} onDismiss={close}>
      <Dialog.Title>{title}</Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView style={{maxHeight: 480}}>
          {fits ? (
            <View style={{alignItems: 'center', paddingVertical: 8}}>
              <QrCodeView value={code} size={260} testID={`${testPrefix}-qr`} />
            </View>
          ) : (
            <Text variant="bodyMedium" testID={`${testPrefix}-too-big`}>
              {`This ${what} is too big for one QR code (${code.length} of about ${QR_MAX_CHARS} characters). Share it as a file or copy the code instead.`}
            </Text>
          )}
          <Text variant="bodySmall" style={{marginTop: 6}}>
            {hint}
          </Text>
          {note ? (
            <Text variant="bodySmall" style={{marginTop: 6}}>
              {note}
            </Text>
          ) : null}
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions style={{flexWrap: 'wrap'}}>
        <Button testID={`${testPrefix}-copy`} onPress={copy}>
          Copy code
        </Button>
        <Button testID={`${testPrefix}-file`} onPress={shareFile}>
          Share as file
        </Button>
        <Button onPress={close}>Close</Button>
      </Dialog.Actions>
    </Dialog>
  );
};
