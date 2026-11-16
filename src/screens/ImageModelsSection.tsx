import React, {useCallback, useEffect, useState} from 'react';
import {Alert, View} from 'react-native';
import {Button, Card, Chip, Text} from 'react-native-paper';
import {usePcHardware} from '../services/desktop/pcHardware';

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
  fitForCard,
  PictureFile,
  SD15_LICENCE_ID,
  findPictureFiles,
  localSetFor,
  stopUsingFile,
  registerPictureFile,
} from '../services/imageGen/imageModels';

const FIT_TEXT = {
  fits: 'Fits your graphics card',
  'too-big': 'Too big for your graphics card (very slow)',
} as const;

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
 * licence note the first time with its own question. Below them, picture
 * models already downloaded through the Models screen (a Stable Diffusion
 * 1.5 .gguf can be used as it is: "Use this file for pictures").
 */
export const ImageModelsSection: React.FC<{errorColor: string}> = ({
  errorColor,
}) => {
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [files, setFiles] = useState<PictureFile[]>([]);
  const hardware = usePcHardware();

  const refresh = useCallback(async () => {
    const next: Record<string, boolean> = {};
    for (const set of IMAGE_MODEL_SETS) {
      next[set.id] = await isInstalled(set).catch(() => false);
    }
    setInstalled(next);
    setFiles(await findPictureFiles().catch(() => []));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  /** The licence note (and use rules) the first time; false if declined. */
  const licenceAgreed = async (set: ImageModelSet, id: string) => {
    if (await licenceSeen(id)) {
      return true;
    }
    const agreed = await ask(
      `${set.name}: licence`,
      `${set.licenceNote}${set.useRules ? `\n\nUse rules: ${set.useRules}` : ''}\n\nFull text: ${set.licenceUrl}`,
      'I understand',
    );
    if (agreed) {
      await markLicenceSeen(id);
    }
    return agreed;
  };

  const pickFile = async (file: PictureFile) => {
    setError('');
    const set = localSetFor({id: 'local-x', file: file.file, kind: ''}, 0);
    if (!(await licenceAgreed(set, SD15_LICENCE_ID))) {
      return;
    }
    try {
      await registerPictureFile(file);
    } catch (e) {
      setError(`${file.name}: ${String(e instanceof Error ? e.message : e)}`);
    }
    refresh();
  };

  const stopUsing = async (id: string) => {
    setError('');
    await stopUsingFile(id).catch(e => setError(String(e)));
    refresh();
  };

  const fitChip = (set: ImageModelSet, testID: string) => {
    const fit = fitForCard(set, hardware?.gpus);
    return fit === 'unknown' ? null : (
      <Chip compact testID={testID}>
        {FIT_TEXT[fit]}
      </Chip>
    );
  };

  const download = async (set: ImageModelSet) => {
    setError('');
    if (!(await licenceAgreed(set, set.id))) {
      return;
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
              {fitChip(set, 'toolbox-image-model-fit-' + set.id)}
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
        {files.length ? (
          <View style={{gap: 4, paddingTop: 8}} testID="toolbox-picture-files">
            <Text variant="titleSmall">
              Picture models you already downloaded
            </Text>
            <Text variant="bodySmall">
              Found in the app's models folder (downloaded in Models). A Stable
              Diffusion 1.5 file can be used as it is.
            </Text>
            {files.map(file => {
              const set = localSetFor(
                {id: file.id ?? 'local-x', file: file.file, kind: ''},
                file.size,
              );
              return (
                <View
                  key={file.file}
                  style={{gap: 4, paddingVertical: 4}}
                  testID={'toolbox-picture-file-' + file.name}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}>
                    <Text variant="bodyMedium" style={{flex: 1}}>
                      {file.name}
                    </Text>
                    <Chip compact>{formatGb(file.size)}</Chip>
                    {file.usable
                      ? fitChip(set, 'toolbox-picture-file-fit-' + file.name)
                      : null}
                  </View>
                  {!file.usable ? (
                    <Text variant="bodySmall">
                      Only Stable Diffusion 1.5 files (one .gguf) can be used
                      for pictures for now.
                    </Text>
                  ) : file.id ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                      <Text variant="bodySmall" style={{flex: 1}}>
                        Used for pictures (licence: {set.licence}).
                      </Text>
                      <Button
                        compact
                        testID={'toolbox-picture-file-stop-' + file.name}
                        onPress={() => stopUsing(file.id!)}>
                        Stop using
                      </Button>
                    </View>
                  ) : (
                    <Button
                      testID={'toolbox-picture-file-use-' + file.name}
                      mode="outlined"
                      disabled={busy !== null}
                      onPress={() => pickFile(file)}>
                      Use this file for pictures
                    </Button>
                  )}
                </View>
              );
            })}
          </View>
        ) : null}
        {error ? <Text style={{color: errorColor}}>{error}</Text> : null}
      </Card.Content>
    </Card>
  );
};
