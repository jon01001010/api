import React, {useCallback, useEffect, useState} from 'react';
import {ScrollView, View} from 'react-native';
import {observer} from 'mobx-react-lite';
import {Button, Card, RadioButton, Text} from 'react-native-paper';
import {useIsFocused} from '@react-navigation/native';
import {modelStore} from '../../store';
import {DeviceOption, getDeviceOptions} from '../../utils/deviceSelection';

export const PocketAgentHardwareScreen = observer(() => {
  const focused = useIsFocused();
  const [options, setOptions] = useState<DeviceOption[]>([]);
  const [checking, setChecking] = useState(false);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      setOptions(await getDeviceOptions());
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
          {options.length === 0 && !checking && (
            <Text>No inference backends detected yet.</Text>
          )}
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
    </ScrollView>
  );
});
