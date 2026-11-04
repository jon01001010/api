import React, {useContext, useEffect} from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import {observer} from 'mobx-react';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import {voiceStore} from '../../store';
import {L10nContext} from '../../utils';
import {
  cancelVoiceInput,
  startVoiceInput,
  stopVoiceInput,
  watchConversation,
} from '../../services/voice/voiceController';
import {watchWake} from '../../services/voice/wakeWord';

interface Props {
  color: string;
}

/**
 * Tap to speak a message; tap again to stop listening early. Long-press
 * opens the Voice input settings (model, conversation mode).
 */
export const MicButton: React.FC<Props> = observer(({color}) => {
  const l10n = useContext(L10nContext);
  const state = voiceStore.state;

  useEffect(() => watchConversation(), []);
  // Wake word: keeps the mic open for the wake phrase while the app is idle.
  useEffect(() => watchWake(), []);

  const onPress = () => {
    if (state === 'listening') {
      stopVoiceInput();
    } else if (state === 'idle') {
      startVoiceInput().catch(() => {});
    }
  };

  const listening = state === 'listening';
  // Ring grows with loudness so the user can see they are heard.
  const ring = listening ? 1 + Math.min(1, voiceStore.level * 8) * 0.5 : 1;

  return (
    <TouchableOpacity
      testID="mic-button"
      style={styles.button}
      onPress={onPress}
      onLongPress={() => {
        if (listening) {
          cancelVoiceInput();
        }
        voiceStore.openSheet();
      }}
      accessibilityRole="button"
      accessibilityLabel={
        listening
          ? l10n.voiceAndSpeech.voiceInput.stopLabel
          : l10n.voiceAndSpeech.voiceInput.micLabel
      }
      accessibilityState={{busy: state === 'transcribing'}}>
      {listening ? (
        <View
          testID="mic-listening"
          style={[
            styles.ring,
            {borderColor: color, transform: [{scale: ring}]},
          ]}
        />
      ) : null}
      {state === 'transcribing' ? (
        <ActivityIndicator
          testID="mic-transcribing"
          size="small"
          color={color}
        />
      ) : (
        <Icon
          name={listening ? 'stop' : 'microphone'}
          size={22}
          color={color}
        />
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    opacity: 0.6,
  },
});
