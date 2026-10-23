import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import {Button, Text} from 'react-native-paper';
import {getDeviceOptions, type DeviceOption} from '../utils/deviceSelection';

/** Reports llama.rn backends actually enumerated on this device.
 * No backend is activated here: changing acceleration requires a model reload
 * through the existing model settings flow.
 */
export const AccelerationAdvice: React.FC = () => {
  const [options, setOptions] = useState<DeviceOption[]>([]);
  const [status, setStatus] = useState('Checking runtime backends…');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let mounted = true;
    getDeviceOptions().then(found => {
      if (!mounted) return;
      setOptions(found);
      setStatus('Available backends reported by llama.rn');
    }).catch(() => {
      if (mounted) setStatus('Backend detection failed; CPU may still work.');
    });
    return () => {mounted = false;};
  }, [refresh]);
  return <View style={{paddingHorizontal: 16, paddingVertical: 8, gap: 4}}>
    <Text variant="titleSmall">CPU / GPU / NPU acceleration</Text>
    <Text variant="bodySmall">{status}</Text>
    {options.map(option => <Text key={option.id} variant="bodySmall">
      {option.label}: {option.description}{option.experimental ? ' (experimental)' : ''}
    </Text>)}
    <Text variant="bodySmall">A detected GPU or Hexagon NPU does not guarantee this model or quantization will run there. CPU is the safe fallback. Choose a backend in the model settings and reload the model; this panel never changes settings automatically.</Text>
    <Button compact onPress={() => setRefresh(v => v + 1)}>Recheck backends</Button>
  </View>;
};
