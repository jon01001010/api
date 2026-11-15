import React, {useCallback, useEffect, useState} from 'react';
import {Alert, View} from 'react-native';
import {Button, Card, Chip, Text} from 'react-native-paper';

import {
  IMAGE_MODEL_SETS,
  ImageModelSet,
  downloadQuestion,
  downloadSet,
  formatGb,
  isInstalled,
  licenceSeen,
  markLicenceSeen,
  setBytes,
  verifiedNote,
} from '../services/imageGen/imageModels';

const ask = (title: string, message: string, ok: string) =>
  new Promise<boolean>(resolve =>
    Alert.alert(title, message, [
      {text: 'Cancel', style: 'cancel', onPress: () => resolve(false)},
      {text: ok, onPress: () => resolve(true)},
    ]),
  );

/**
 * Toolbox, desktop app only: the picture models for image_generate. Size,
 * licence (and use rules) are shown before anything is downloaded; the
 * licence note the first time with its own question.
 */
export const ImageModelsSection: React.FC<{errorColor: string}> = ({
  errorColor,
}) => {
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    const next: Record<string, boolean> = {};
    for (const set of IMAGE_MODEL_SETS) {
      next[set.id] = await isInstalled(set).catch(() => false);
    }
    setInstalled(next);
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const download = async (set: ImageModelSet) => {
    setError('');
    if (!(await licenceSeen(set.id))) {
      const agreed = await ask(
        `${set.name}: licence`,
        `${set.licenceNote}${set.useRules ? `\n\nUse rules: ${set.useRules}` : ''}\n\nFull text: ${set.licenceUrl}`,
        'I understand',
      );
      if (!agreed) {
        return;
      }
      await markLicenceSeen(set.id);
    }
    if (
      !(await ask('Download picture model?', downloadQuestion(set), 'Download'))
    ) {
      return;
    }
    setBusy(set.id);
    try {
      await downloadSet(set, (done, total) =>
        setProgress(`${formatGb(done)} of about ${formatGb(total)}`),
      );
    } catch (e) {
      setError(`${set.name}: ${String(e instanceof Error ? e.message : e)}`);
    } finally {
      setBusy(null);
      setProgress('');
      refresh();
    }
  };

  return (
    <Card mode="outlined" testID="toolbox-image-models">
      <Card.Content style={{gap: 6}}>
        <Text variant="titleMedium">Image models (for image_generate)</Text>
        <Text variant="bodyMedium">
          Pictures are made on this PC with stable-diffusion.cpp; nothing is
          uploaded. Switch image_generate on below to let the model use it. Not
          on ARM Linux (far too slow there).
        </Text>
        {IMAGE_MODEL_SETS.map(set => (
          <View key={set.id} style={{gap: 4, paddingVertical: 4}}>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
              }}>
              <Text variant="titleSmall" style={{flex: 1}}>
                {set.name}
              </Text>
              <Chip compact>{set.licence}</Chip>
              <Chip compact>about {formatGb(setBytes(set))}</Chip>
            </View>
            <Text variant="bodySmall">{set.licenceNote}</Text>
            {verifiedNote(set) ? (
              <Text
                variant="bodySmall"
                testID={'toolbox-image-model-unverified-' + set.id}>
                {verifiedNote(set)}
              </Text>
            ) : null}
            {installed[set.id] ? (
              <Text variant="bodySmall">Downloaded.</Text>
            ) : (
              <Button
                testID={'toolbox-image-model-download-' + set.id}
                mode="outlined"
                disabled={busy !== null}
                onPress={() => download(set)}>
                {busy === set.id ? `Downloading… ${progress}` : 'Download'}
              </Button>
            )}
          </View>
        ))}
        {error ? <Text style={{color: errorColor}}>{error}</Text> : null}
      </Card.Content>
    </Card>
  );
};
