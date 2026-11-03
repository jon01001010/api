import React, {useEffect, useState} from 'react';
import {ScrollView, View} from 'react-native';
import {Button, Text} from 'react-native-paper';
import Clipboard from '@react-native-clipboard/clipboard';
import {clearToolAudit, exportToolAudit, loadToolAudit, snapshotToolAudit, subscribeToolAudit} from '../services/diagnostics/ToolAuditStore';
import type {ToolCallRecord} from '../services/diagnostics/ToolCallJournal';

export const ToolAuditPanel = () => {
  const [items, setItems] = useState<ToolCallRecord[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => {if (active) setItems(snapshotToolAudit());};
    const unsubscribe = subscribeToolAudit(refresh);
    loadToolAudit().then(refresh).catch(e => setError('History unavailable: ' + String(e)));
    return () => {active = false; unsubscribe();};
  }, []);
  return <View style={{gap: 8}}>
    <Text variant="titleMedium">Tool activity history</Text>
    <Text variant="bodySmall">Last 200 actions on this device. No arguments, results, or message contents stored.</Text>
    {error ? <Text>{error}</Text> : null}
    <View style={{flexDirection: 'row'}}>
      <Button onPress={() => Clipboard.setString(exportToolAudit())}>Copy JSON</Button>
      <Button onPress={() => clearToolAudit().catch(e => setError(String(e)))}>Clear history</Button>
    </View>
    <ScrollView nestedScrollEnabled style={{maxHeight: 260}}>
      {items.length === 0 ? <Text>No activity recorded.</Text> :
        [...items].reverse().map((r, i) =>
          <Text key={`${r.startedAt}-${r.id}-${i}`} variant="bodySmall">
            {new Date(r.startedAt).toLocaleString()} · {r.tool} · {r.status}{r.elapsedMs === undefined ? '' : ` · ${r.elapsedMs}ms`}
          </Text>)}
    </ScrollView>
  </View>;
};
