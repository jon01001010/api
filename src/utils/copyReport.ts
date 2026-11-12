/**
 * Reports, feedback and benchmark results are copied, never sent: the user
 * pastes them wherever they choose (for example a GitHub issue). PocketPal's
 * Firebase senders stay in the code but off (config/outside.ts).
 */
import {Alert} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

export const COPIED_MESSAGE =
  'Copied. Paste it wherever you want to send it (for example a GitHub issue). Nothing was sent from the app.';

export function copyReport(title: string, data: unknown): void {
  Clipboard.setString(
    typeof data === 'string' ? data : JSON.stringify(data, null, 2),
  );
  Alert.alert(title, COPIED_MESSAGE);
}
