import React, {useState} from 'react';
import {View} from 'react-native';
import {Button, Card, Text} from 'react-native-paper';
import type {ToolDiagnostic} from '../services/agent/toolDiagnostics';

/** Optional developer-only view. Parent must opt in; no telemetry is transmitted. */
export function ToolDiagnosticCard({record}: {record: ToolDiagnostic}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Card mode="outlined" testID={'tool-diagnostic-' + record.callId}>
      <Card.Content>
        <Text variant="titleSmall">{record.toolName} · {record.status}</Text>
        <Text variant="bodySmall">{record.durationMs} ms · {new Date(record.startedAt).toLocaleTimeString()}</Text>
        <Button onPress={() => setExpanded(v => !v)}>{expanded ? 'Hide details' : 'Inspect call'}</Button>
        {expanded ? <View>
          <Text variant="labelMedium">Arguments (redacted)</Text>
          <Text selectable>{record.rawArguments}</Text>
          <Text variant="labelMedium">Tool response</Text>
          <Text selectable>{record.resultSummary}</Text>
        </View> : null}
      </Card.Content>
    </Card>
  );
}
