import React, {useEffect, useState} from 'react';
import {Image, View} from 'react-native';
import {Button} from 'react-native-paper';
import * as RNFS from '@dr.pogodin/react-native-fs';
import Share from 'react-native-share';

import {Text} from '../../components/ThemedText';

import {TalentUI} from './TalentUIRegistry';
import {TalentResult} from './types';

/** A picture in the workspace's `images` folder (made on the PC). */
const isWorkspacePicture = (path: string) =>
  /^\/pocketagent\/Documents\/PocketAgentFiles\/images\/picture-[A-Za-z0-9-]+\.png$/.test(
    path,
  );

/**
 * A picture the Home PC made for this phone: in the app's own cache folder
 * (`pc-pictures`, named by HomeLinkModule.kt).
 */
function isPcPicture(path: string): boolean {
  const dir = (RNFS as {CachesDirectoryPath?: unknown}).CachesDirectoryPath;
  if (typeof dir !== 'string' || dir.length < 2) {
    return false;
  }
  const rest = path.startsWith(dir.replace(/\/+$/, '') + '/pc-pictures/')
    ? path.slice(dir.replace(/\/+$/, '').length + '/pc-pictures/'.length)
    : '';
  return /^picture-[A-Za-z0-9-]+\.png$/.test(rest);
}

/** Only the app's own pictures folders: never any other path. */
export function isOwnPicture(path: string): boolean {
  return (
    (isWorkspacePicture(path) || isPcPicture(path)) && !path.includes('..')
  );
}

/**
 * A picture made on the PC (image_generate; on the phone, by the paired Home
 * PC): read from the app's own folder (no question) and shown inline; "Save a copy" opens the native Save
 * dialog (src-tauri/src/transfer.rs save_copy).
 */
export const GeneratedPicture: React.FC<{path: string; name: string}> = ({
  path,
  name,
}) => {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    if (!isOwnPicture(path)) {
      setError('Not one of the app’s pictures.');
      return;
    }
    RNFS.readFile(path, 'base64')
      .then(data => alive && setUri(`data:image/png;base64,${data}`))
      .catch(e => alive && setError(String(e?.message ?? e)));
    return () => {
      alive = false;
    };
  }, [path]);
  return (
    <View testID="generated-picture" style={{gap: 6, marginVertical: 6}}>
      {uri ? (
        <Image
          testID="generated-picture-image"
          source={{uri}}
          accessibilityLabel={name}
          style={{width: '100%', maxWidth: 512, aspectRatio: 1}}
          resizeMode="contain"
        />
      ) : (
        <Text>{error || 'Loading the picture…'}</Text>
      )}
      <View style={{flexDirection: 'row', alignItems: 'center', gap: 8}}>
        <Text style={{flex: 1}}>
          {isWorkspacePicture(path) ? `images/${name}` : name}
        </Text>
        <Button
          testID="generated-picture-save"
          disabled={!uri}
          onPress={() =>
            Share.open({
              url: 'file://' + path,
              filename: name,
              type: 'image/png',
              failOnCancel: false,
            }).catch(() => {})
          }>
          Save a copy…
        </Button>
      </View>
    </View>
  );
};

export class ImageTalentUI implements TalentUI {
  readonly name = 'image_generate';

  renderResult(result: TalentResult): React.ReactNode {
    if (result.type !== 'image') {
      return null;
    }
    return <GeneratedPicture path={result.path} name={result.name} />;
  }
}
