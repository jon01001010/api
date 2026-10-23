import React, {useEffect, useState} from 'react';
import {View} from 'react-native';
import DeviceInfo from 'react-native-device-info';
import {Text} from 'react-native-paper';
import {checkGpuSupport} from '../utils/deviceCapabilities';
import {estimateModelFit} from '../utils/modelFit';
import {modelStore} from '../store';

/** Hardware information only: never blocks a user from choosing a model. */
export const ModelHardwareAdvice: React.FC = () => {
  const [ram, setRam] = useState<number | null>(null);
  const [gpu, setGpu] = useState<string>('Checking acceleration…');
  useEffect(() => {
    let live = true;
    DeviceInfo.getTotalMemory().then(value => {if (live) setRam(value);}).catch(() => {});
    checkGpuSupport().then(value => {
      if (live) setGpu(value.isSupported ? 'Compatible GPU acceleration detected' : 'GPU acceleration not confirmed; CPU may be used');
    }).catch(() => {if (live) setGpu('Acceleration capability unknown');});
    return () => {live = false;};
  }, []);
  const model = modelStore.activeModel;
  const fit = estimateModelFit(ram ?? 0, model?.size ?? 0);
  return <View style={{paddingHorizontal: 16, paddingVertical: 8, gap: 4}}>
    <Text variant="titleSmall">Device and model fit</Text>
    <Text variant="bodySmall">Total RAM: {ram ? (ram / 1024 ** 3).toFixed(1) + ' GiB' : 'Unknown'} · {gpu}</Text>
    <Text variant="bodySmall">{model ? `Loaded selection: ${model.name}. ${fit.detail}` : 'Select a model to estimate its memory requirements.'}</Text>
    <Text variant="bodySmall">Estimates exclude unknown vision projector sizes and vary with context length, quantization and other apps. Hardware detection is guidance, not a restriction.</Text>
  </View>;
};
