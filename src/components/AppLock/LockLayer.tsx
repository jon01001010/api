import * as React from 'react';
import {Modal} from 'react-native';

/**
 * The PIN screen over the app when it locks again (AppLockRoot): a window
 * of its own above the app's dialogs. The desktop has its own
 * (LockLayer.web.tsx).
 */
export function LockLayer({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  return (
    <Modal
      visible
      animationType="none"
      statusBarTranslucent
      onRequestClose={() => {}}>
      {children}
    </Modal>
  );
}
