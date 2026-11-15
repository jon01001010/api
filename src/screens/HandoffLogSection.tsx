import React, {useEffect, useState} from 'react';
import {Card, Text} from 'react-native-paper';

import {
  handoffLine,
  readHandoffLog,
  type HandoffLogEntry,
} from '../services/agent/handoffLog';

const SHOWN = 20;

/**
 * Toolbox: the newest hand-offs to other models (ask_other_model), allowed
 * or not: model, where, sizes, outcome. Never the text. Nothing shown
 * before the first one.
 */
export const HandoffLogSection: React.FC<{focused: boolean}> = ({focused}) => {
  const [entries, setEntries] = useState<HandoffLogEntry[]>([]);
  useEffect(() => {
    if (!focused) {
      return;
    }
    let alive = true;
    readHandoffLog()
      .then(list => alive && setEntries(list.slice(0, SHOWN)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [focused]);
  if (!entries.length) {
    return null;
  }
  return (
    <Card mode="outlined" testID="handoff-log">
      <Card.Title title="Hand-offs to other models" />
      <Card.Content>
        <Text variant="bodySmall">
          The newest {entries.length} (ask_other_model). Kept on this device;
          the text sent is never logged.
        </Text>
        {entries.map(e => (
          <Text
            key={`${e.at}-${e.model}-${e.outcome}`}
            variant="bodySmall"
            selectable>
            {handoffLine(e)}
          </Text>
        ))}
      </Card.Content>
    </Card>
  );
};
