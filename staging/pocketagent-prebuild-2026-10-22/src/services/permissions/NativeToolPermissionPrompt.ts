import {Alert} from 'react-native';
import type {AskPermission} from './ToolPermissionGate';
import type {PermissionDecision} from './ToolPermissionPolicy';

/** Explicit user approval only. No model input is interpreted as consent.
 * Dismissal, Android back, and prompt failures all deny.
 */
export const askNativeToolPermission: AskPermission = request =>
  new Promise<PermissionDecision>(resolve => {
    let settled = false;
    const finish = (choice: PermissionDecision) => {
      if (settled) return;
      settled = true;
      resolve(choice);
    };
    try {
      Alert.alert(
        'PocketAgent tool permission',
        `Allow ${request.tool} to use ${request.category}?\n\n` +
          'The assistant requested this action. Review the request before allowing it. ' +
          'Allow once applies to one tool call. Always allow lasts until this agent run ends.',
        [
          {text: 'Deny', style: 'cancel', onPress: () => finish('deny')},
          {text: 'Allow once', onPress: () => finish('allow-once')},
          {text: 'Always allow', onPress: () => finish('allow-always')},
        ],
        {cancelable: true, onDismiss: () => finish('deny')},
      );
    } catch {
      finish('deny');
    }
  });
