import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import {Button, Switch, Text} from 'react-native-paper';
import {ToolDiagnosticCard} from './ToolDiagnosticCard';
import {clearToolDiagnostics, enableToolDiagnostics, getToolDiagnostics,
  subscribeToolDiagnostics, toolDiagnosticsEnabled} from '../services/agent/toolDiagnosticStore';

/** Mount inside ToolboxScreen. Disabled by default and clears on disable. */
export function ToolDiagnosticsPanel() {
  const [enabled, setEnabled] = useState(toolDiagnosticsEnabled());
  const [records, setRecords] = useState(getToolDiagnostics());
  useEffect(() => subscribeToolDiagnostics(() => {
    setEnabled(toolDiagnosticsEnabled());
    setRecords(getToolDiagnostics());
  }), []);
  return <View style={{gap: 8}}>
    <Text variant="titleMedium">Developer diagnostics</Text>
    <Text variant="bodySmall">Session-only. Tool arguments and results may contain personal information. Turn off to erase the log.</Text>
    <Switch value={enabled} onValueChange={enableToolDiagnostics} />
    {enabled ? <>
      <Button onPress={clearToolDiagnostics}>Clear diagnostic log</Button>
      {records.length ? records.map((record, index) =>
        <ToolDiagnosticCard key={`${record.callId}-${record.startedAt}-${index}`} record={record} />
      ) : <Text>No tool calls recorded yet.</Text>}
    </> : null}
  </View>;
}
