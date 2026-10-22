/**
 * PocketAgent permission explanations, independent of Android OS permission grants.
 * These are disclosure templates, NOT evidence that a capability is implemented.
 * Show only when the corresponding feature is actually available.
 */
export type AccessDuration = 'once' | 'task' | 'remember';
export type VoiceMode = 'off' | 'push_to_talk' | 'wake_word' | 'conversation';
export type PermissionFeature = 'file_read' | 'internet' | 'notifications' | 'background_tasks' | 'microphone';

export interface PermissionExplanation {
  title: string;
  why: string;
  scope: string;
  duration: string;
  dataHandling: string;
  canDecline: string;
}

export const DEFAULT_VOICE_MODE: VoiceMode = 'off';

export const VOICE_MODES: Record<VoiceMode, {title: string; explanation: string}> = {
  off: {
    title: 'No listening',
    explanation: 'PocketAgent does not start microphone capture or wake-word detection.',
  },
  push_to_talk: {
    title: 'Push to talk',
    explanation: 'Record only when you explicitly press the microphone control. Stop on release or cancellation.',
  },
  wake_word: {
    title: 'Wake word',
    explanation: 'Continuously monitor microphone input for a chosen phrase while enabled. Requires a separately verified on-device detector and persistent microphone indicator.',
  },
  conversation: {
    title: 'Conversation',
    explanation: 'Listen for follow-up questions during a clearly displayed, limited session. Stop at the session timeout or when muted.',
  },
};

const DURATION_COPY: Record<AccessDuration, string> = {
  once: 'Only for this action. Release app-held access when the action ends or is cancelled.',
  task: 'Until this task ends, expires, or is cancelled. Show the expiry before starting.',
  remember: 'Until you revoke the choice. Android may impose its own limits or require separate approval.',
};

export function explainPermission(
  feature: PermissionFeature,
  duration: AccessDuration,
  detail: {resource?: string; task?: string; expiresAt?: string; localOnly?: boolean} = {},
): PermissionExplanation {
  const task = detail.task || 'the action you requested';
  const resource = detail.resource || 'the item you select';
  const durationText = duration === 'task' && detail.expiresAt
    ? DURATION_COPY.task + ' Scheduled expiry: ' + detail.expiresAt + '.'
    : DURATION_COPY[duration];
  const common = {
    duration: durationText,
    canDecline: 'You can decline. This feature will remain unavailable; other features will still work.',
  };
  switch (feature) {
    case 'file_read':
      return {
        ...common,
        title: 'Read a selected file',
        why: 'To complete ' + task + '.',
        scope: 'Only ' + resource + ', not your entire file collection.',
        dataHandling: detail.localOnly
          ? 'Process locally. Any later cloud upload requires separate consent.'
          : 'The destination and whether data leaves the device must be disclosed before processing.',
      };
    case 'internet':
      return {
        ...common,
        title: 'Connect to the internet',
        why: 'To complete ' + task + '.',
        scope: 'The specific service or URL must be shown before connecting.',
        dataHandling: 'Explain what request data will be transmitted and to which service.',
      };
    case 'notifications':
      return {
        ...common,
        title: 'Show notifications',
        why: 'To report task status or completion.',
        scope: 'PocketAgent task notifications only.',
        dataHandling: 'Notifications may appear on the lock screen depending on Android settings.',
      };
    case 'background_tasks':
      return {
        ...common,
        title: 'Run in the background',
        why: 'To continue ' + task + ' when PocketAgent is not visible.',
        scope: 'Only the approved task, with a visible stop control.',
        dataHandling: 'Task state stays on the device unless a separately approved tool transmits it.',
      };
    case 'microphone':
      return {
        ...common,
        title: 'Use the microphone',
        why: 'To capture your voice when you select a listening mode.',
        scope: 'The selected mode determines when recording can occur. No listening is the default.',
        dataHandling: 'Whether audio is processed locally or sent to a provider must be stated before activation.',
      };
  }
}
