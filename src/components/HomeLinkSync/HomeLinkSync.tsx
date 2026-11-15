import React, {useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {Button, Switch, Text} from 'react-native-paper';

import {
  mirrorChatsOn,
  setMirrorChats,
  setSyncWithPc,
  syncWithPc,
  syncWithPcOn,
} from '../../services/sync/deviceSync';
import {describeKeys} from '../../services/sync/promptSync';
import {describeDeletes} from '../../services/sync/chatDeletes';
import {describeAssistantDeletes} from '../../services/sync/assistantDeletes';
import {RecentlyDeletedAssistants} from './RecentlyDeletedAssistants';
import {RecentlyDeletedChats} from './RecentlyDeletedChats';
import {
  answerForPcOn,
  setAnswerForPc,
} from '../../services/homeLink/pcQuestions';

/**
 * A paired home PC: keep the system prompt, memory, assistants and custom tools in step with it
 * (off until switched on; the PC must allow it too). "Sync now" and the
 * result; it also runs when the PC's model is loaded.
 */
export const HomeLinkSync: React.FC<{pc: string}> = ({pc}) => {
  const [on, setOn] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [answer, setAnswer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState('');
  const [synced, setSynced] = useState(0);

  useEffect(() => {
    syncWithPcOn(pc).then(setOn);
    mirrorChatsOn(pc).then(setMirror);
    answerForPcOn(pc).then(setAnswer);
  }, [pc]);

  const syncNow = async () => {
    setBusy(true);
    setLine('Keeping in step…');
    const r = await syncWithPc(pc);
    setBusy(false);
    if (!r.ok) {
      setLine(`Not in step: ${r.error}`);
      return;
    }
    setSynced(n => n + 1);
    const parts = [
      r.assistantsDeleted
        ? describeAssistantDeletes(r.assistantsDeleted, 'the PC')
        : '',
      r.assistantsHeld
        ? `${r.assistantsHeld} assistants deleted on the PC wait for your answer`
        : '',
      r.chatsDeleted ? describeDeletes(r.chatsDeleted, 'the PC') : '',
      r.chatsHeld
        ? `${r.chatsHeld} chats deleted on the PC wait for your answer`
        : '',
      r.chatsReceived ? `${r.chatsReceived} chat(s) from the PC` : '',
      r.chatsSent ? `${r.chatsSent} chat(s) to the PC` : '',
      r.changedHere.length
        ? `${describeKeys(r.changedHere)} taken from the PC`
        : '',
      r.changedOnPc.length
        ? `${describeKeys(r.changedOnPc)} sent to the PC`
        : '',
    ].filter(Boolean);
    setLine(
      parts.length
        ? `${parts.join('; ')}. Earlier versions are kept in history.`
        : 'Already in step.',
    );
  };

  return (
    <View testID="home-link-sync">
      <View style={styles.row}>
        <Text variant="bodySmall" style={styles.text}>
          Keep the system prompt, memory, assistants and custom tools in step
          with this PC (the newer edit wins; the other is kept in history).
          Deleting one of your assistants deletes it on the PC too (unless
          changed there since). The PC must allow it too.
        </Text>
        <Switch
          value={on}
          onValueChange={async v => {
            await setSyncWithPc(pc, v);
            setOn(v);
            if (v) {
              syncNow();
            }
          }}
          testID="home-link-sync-switch"
        />
      </View>
      {on ? (
        <View style={styles.row}>
          <Text variant="bodySmall" style={styles.text}>
            Mirror chats with this PC too: your chats show up on both, and a
            reply here reaches the PC a moment later. Deleting a chat on one
            deletes it on the other (unless changed there since); it is kept 30
            days under Recently deleted. The PC must allow it too.
          </Text>
          <Switch
            value={mirror}
            onValueChange={async v => {
              await setMirrorChats(pc, v);
              setMirror(v);
              if (v) {
                syncNow();
              }
            }}
            testID="home-link-mirror-switch"
          />
        </View>
      ) : null}
      {on && mirror ? <RecentlyDeletedChats refresh={synced} /> : null}
      {on ? <RecentlyDeletedAssistants refresh={synced} /> : null}
      {on ? (
        <Button
          compact
          mode="outlined"
          disabled={busy}
          onPress={syncNow}
          testID="home-link-sync-now">
          Sync now
        </Button>
      ) : null}
      <View style={styles.row}>
        <Text variant="bodySmall" style={styles.text}>
          Show this PC's "Allow?" questions here and answer them (allow once or
          refuse). The PC must allow it too.
        </Text>
        <Switch
          value={answer}
          onValueChange={async v => {
            await setAnswerForPc(pc, v);
            setAnswer(v);
          }}
          testID="home-link-answer-switch"
        />
      </View>
      {line ? (
        <Text variant="bodySmall" testID="home-link-sync-result">
          {line}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {flexDirection: 'row', alignItems: 'center', marginVertical: 6},
  text: {flex: 1, paddingRight: 12},
});
