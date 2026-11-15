/**
 * "Find the fit" before download: about how much memory a model needs and
 * where it would run here ("Fits on your graphics card (fast)", "Fits on
 * this phone", "Too big for this PC", …), plus a note for mixture-of-experts
 * models. Estimate and labels: utils/modelFit.
 */
import React, {useEffect, useState} from 'react';
import {Platform, StyleProp, TextStyle} from 'react-native';
import {Text} from 'react-native-paper';
import {observer} from 'mobx-react';
import DeviceInfo from 'react-native-device-info';

import {modelStore} from '../../store';
import {formatBytes} from '../../utils';
import {
  FIT_TEXT,
  fitOnThisPc,
  usePcHardware,
} from '../../services/desktop/pcHardware';
import {
  MOE_TEXT,
  PHONE_FIT_TEXT,
  coldStartCeiling,
  estimateMemoryNeeded,
  estimateParams,
  isMixtureOfExperts,
  phoneFit,
} from '../../utils/modelFit';

interface FitProps {
  /** File size, with the vision part if it comes along. */
  fileBytes: number;
  /** File or model name (size, quantization and MoE are read from it). */
  name: string;
  /** Parameter count, when known (Hugging Face, or the loaded model). */
  params?: number;
}

/** The label text, or '' while the device isn't known yet. */
export function useFitText({fileBytes, name, params}: FitProps): string {
  const pc = usePcHardware();
  const [phoneMemory, setPhoneMemory] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    if (!pc && Platform.OS !== 'web') {
      Promise.resolve()
        .then(() => DeviceInfo.getTotalMemory())
        .then(total => alive && total > 0 && setPhoneMemory(total))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [pc]);

  if (!fileBytes) {
    return '';
  }
  const nCtx = modelStore.contextInitParams?.n_ctx || 4096;
  const need = estimateMemoryNeeded(
    fileBytes,
    nCtx,
    estimateParams(name, fileBytes, params),
  );
  let where = '';
  if (pc) {
    where = FIT_TEXT[fitOnThisPc(need, pc)];
  } else if (phoneMemory) {
    const learned = Math.max(
      modelStore.largestSuccessfulLoad ?? 0,
      modelStore.availableMemoryCeiling ?? 0,
    );
    where =
      PHONE_FIT_TEXT[
        phoneFit(need, {
          totalMemory: phoneMemory,
          ceiling: learned || coldStartCeiling(phoneMemory),
        })
      ];
  }
  if (!where) {
    return '';
  }
  const parts = [`Needs about ${formatBytes(need, 1)}`, where];
  if (isMixtureOfExperts(name)) {
    parts.push(MOE_TEXT);
  }
  return parts.join(' · ');
}

export const FitLabel: React.FC<FitProps & {style?: StyleProp<TextStyle>}> =
  observer(({style, ...props}) => {
    const text = useFitText(props);
    if (!text) {
      return null;
    }
    return (
      <Text variant="labelSmall" style={style} testID="fit-label">
        {text}
      </Text>
    );
  });
