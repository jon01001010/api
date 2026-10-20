import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, View} from 'react-native';
import {observer} from 'mobx-react-lite';
import {Button, Card, RadioButton, Text} from 'react-native-paper';
import {useIsFocused} from '@react-navigation/native';
import {modelStore} from '../store';
import {DeviceOption, getDeviceOptions, getAvailableDevices} from '../utils/deviceSelection';
import {LocalApiCard} from './SettingsScreen/LocalApiCard';
import NativeHardwareInfo from '../specs/NativeHardwareInfo';

export const PocketAgentHardwareScreen = observer(() => {
  const focused = useIsFocused();
  const [options, setOptions] = useState<DeviceOption[]>([]);
  const [checking, setChecking] = useState(false);
  const [scanError, setScanError] = useState('');
  const [scanResult, setScanResult] = useState('');
  const [hardwareInfo, setHardwareInfo] = useState('Not checked');

  const refresh = useCallback(async () => {
    setChecking(true);
    setScanError('');
    setScanResult('Scanning inference runtime…');
    try {
      const [discovered, rawBackends, cpu, gpu, chipset] = await Promise.all([
        getDeviceOptions(),
        getAvailableDevices(),
        NativeHardwareInfo.getCPUInfo().catch(() => null),
        NativeHardwareInfo.getGPUInfo().catch(() => null),
        NativeHardwareInfo.getChipset?.().catch(() => 'Unknown chipset') ?? Promise.resolve('Unknown chipset'),
      ]);
      setHardwareInfo([
        `Chipset: ${chipset || cpu?.socModel || 'Unknown'}`,
        `CPU: ${cpu?.cores ?? 'Unknown'} cores`,
        `GPU: ${gpu?.renderer || 'Unknown'}`,
        `GPU OpenCL capability: ${gpu?.supportsOpenCL ? 'reported' : 'not reported'}`,
        `Inference backends: ${rawBackends.length ? rawBackends.map(device => `${device.deviceName || 'Unnamed'} (${device.type || 'unknown type'})`).join(', ') : 'none reported'}`,
        `Hexagon HTP backend: ${rawBackends.some(device => device.deviceName?.startsWith('HTP')) ? 'reported' : 'not reported'}`,
      ].join('\n'));
      setOptions(discovered);
      const accelerators = discovered.filter(option => option.id !== 'cpu' && option.id !== 'auto');
      setScanResult(accelerators.length
        ? `Scan complete: ${discovered.map(option => option.label).join(', ')}. Backend availability does not confirm model offload.`
        : `Scan complete: CPU only. ${rawBackends.length ? 'Native backend enumeration returned devices, but no selectable GPU or Hexagon backend.' : 'Native backend enumeration returned no devices.'}`);
    } catch (error) {
      setScanError(error instanceof Error ? error.message : 'Hardware scan failed');
      setScanResult('Scan failed.');
      setOptions([]);
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (focused) {
      refresh();
    }
  }, [focused, refresh]);

  const configured = modelStore.contextInitParams.devices;
  const selected = !configured?.length || configured[0] === 'CPU'
    ? 'cpu'
    : configured[0].startsWith('HTP') ? 'hexagon' : 'gpu';

  const select = (option: DeviceOption) => {
    modelStore.setDevices(option.devices);
    modelStore.setNGPULayers(option.n_gpu_layers);
    const current = modelStore.contextInitParams.flash_attn_type ?? 'off';
    if (!option.valid_flash_attn_types.includes(current)) {
      modelStore.setFlashAttnType(option.default_flash_attn_type);
    }
  };

  return (
    <ScrollView contentContainerStyle={{padding: 16, gap: 16}}>
      <Card>
        <Card.Title title="PocketAgent Hardware" subtitle="Live backend discovery" />
        <Card.Content>
          <Text variant="bodyMedium">
            Backends reported by the inference engine. NPU appears only when
            the Hexagon runtime is detected.
          </Text>
          <Button onPress={refresh} loading={checking} disabled={checking}>
            Scan hardware
          </Button>
          {scanResult ? <Text variant="bodyMedium" accessibilityLiveRegion="polite">{scanResult}</Text> : null}
          {scanError ? <Text>{scanError}</Text> : null}
          {options.length === 0 && !checking && !scanError && (
            <Text>No inference backends detected yet.</Text>
          )}
        </Card.Content>
      </Card>
      <Card>
        <Card.Title title="Physical hardware" subtitle="Reported by Android hardware information" />
        <Card.Content>
          <Text variant="bodyMedium">{hardwareInfo}</Text>
          <Text variant="bodySmall">A chipset or GPU capability does not guarantee an available llama.cpp acceleration backend.</Text>
        </Card.Content>
      </Card>
      <Card>
        <Card.Title title="Processor selection" />
        <Card.Content>
          {options.map(option => (
            <View key={option.id} style={{paddingVertical: 6}}>
              <RadioButton.Item
                label={option.label}
                value={option.id}
                status={selected === option.id ? 'checked' : 'unchecked'}
                onPress={() => select(option)}
              />
              <Text variant="bodySmall">{option.description}</Text>
            </View>
          ))}
          <Text variant="bodySmall" style={{marginTop: 12}}>
            Selection applies when a model is next loaded. An NPU selection
            does not prove offload. Verify with a compatible model and
            runtime diagnostics before reporting NPU execution.
          </Text>
        </Card.Content>
      </Card>
      <Card>
        <Card.Title title="Execution diagnostics" />
        <Card.Content>
          <Text variant="bodyMedium">
            Configured processor: {selected === 'hexagon' ? 'Hexagon NPU' : selected === 'gpu' ? 'GPU' : 'CPU'}
          </Text>
          <Text variant="bodyMedium">
            Model context: {modelStore.context ? 'Loaded' : 'Not loaded'}
          </Text>
          <Text variant="bodyMedium">
            Verified NPU execution: Not yet measured
          </Text>
          <Text variant="bodySmall">
            Hardware detection and configuration alone cannot confirm where model operations execute.
          </Text>
        </Card.Content>
      </Card>
      <LocalApiCard />
    </ScrollView>
  );
});
