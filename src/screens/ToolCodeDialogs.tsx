/**
 * Toolbox → Custom tools: share a tool (QR, file, copied code) and read any
 * PocketAgent code (camera, file or pasted text). TODO.md "One QR scanner
 * for everything". A code is data only: a tool is checked like tool_save,
 * shown in full and installed switched off; a loop (`PA1:L:`) is shown in
 * full with its dry run and installed paused, not started; a pairing code
 * goes to the existing pairing (pairHomePc). Nothing from a code is ever
 * run.
 */
import React, {useEffect, useRef, useState} from 'react';
import {Alert, Platform, ScrollView, View} from 'react-native';
import {Button, Dialog, Portal, Text, TextInput} from 'react-native-paper';
import Clipboard from '@react-native-clipboard/clipboard';
import * as RNFS from '@dr.pogodin/react-native-fs';
import {
  errorCodes,
  isErrorWithCode,
  pick,
  types,
} from '@react-native-documents/picker';
import {
  Camera,
  Code,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';

import {pairHomePc} from '../services/homeLink/pairHomePc';
import type {Loop} from '../services/loops/loops';
import {installSharedLoop, reviewLoopCode} from '../services/loops/loopShare';
import {
  describeCustomTool,
  type CustomTool,
} from '../services/talents/customTools';
import {
  installSharedTool,
  reviewSharedTool,
  reviewToolCode,
  type ReviewResult,
} from '../services/talents/toolImport';
import {MAX_CODE_CHARS, codeKind, packTool} from '../services/talents/toolQr';
import {SharedLoopReview} from './LoopCodeDialogs';
import {ShareCodeDialog} from './ShareCodeDialog';

/** No camera scanning in the desktop app: there you paste or open a file. */
export const canScanWithCamera = () => Platform.OS !== 'web';

export const toolCodeFilename = (name: string) =>
  `${name}.pocketagent-tool.txt`;

// --- share -------------------------------------------------------------------

export const ToolShareDialog: React.FC<{
  tool: CustomTool | null;
  onDismiss: () => void;
}> = ({tool, onDismiss}) => (
  <ShareCodeDialog
    visible={tool !== null}
    title={'Share ' + (tool?.name ?? '')}
    code={tool ? packTool(tool) : ''}
    filename={toolCodeFilename(tool?.name ?? 'tool')}
    what="tool"
    hint="The other device scans this in Toolbox → Scan QR, or pastes the code. It sees every step first, and the tool arrives switched off."
    testPrefix="tool-share"
    onDismiss={onDismiss}
  />
);

// --- receive -----------------------------------------------------------------

const CodeCamera: React.FC<{onCode: (value: string) => void}> = ({onCode}) => {
  const device = useCameraDevice('back');
  const [unknown, setUnknown] = useState(false);
  const [failed, setFailed] = useState(false);
  const done = useRef(false);
  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes: Code[]) => {
      if (done.current) {
        return;
      }
      const value = codes
        .map(c => c.value?.trim() ?? '')
        .find(v => codeKind(v) !== 'unknown');
      if (value) {
        done.current = true;
        onCode(value);
      } else {
        setUnknown(true);
      }
    },
  });
  if (!device || failed) {
    return (
      <Text variant="bodyMedium">
        The camera is not available. Paste the code or open a file instead.
      </Text>
    );
  }
  return (
    <View>
      <Camera
        testID="code-scanner-camera"
        style={{height: 260}}
        device={device}
        isActive
        codeScanner={codeScanner}
        onError={e => {
          if (!e.code.startsWith('unknown/')) {
            setFailed(true);
          }
        }}
      />
      {unknown ? (
        <Text variant="bodySmall" testID="code-scanner-unknown">
          Not a PocketAgent code. Only PocketAgent tools, loops and PC pairing
          codes are read.
        </Text>
      ) : null}
    </View>
  );
};

/** Reads a picked file's text (a shared tool or loop), capped in size. */
async function readCodeFile(): Promise<string | null> {
  try {
    const [file] = await pick({type: [types.allFiles]});
    if (!file) {
      return null;
    }
    if (typeof file.size === 'number' && file.size > MAX_CODE_CHARS * 4) {
      throw new Error('This file is too big to hold a code.');
    }
    return await RNFS.readFile(file.uri, 'utf8');
  } catch (e) {
    if (isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED) {
      return null;
    }
    throw e;
  }
}

interface ReceiveProps {
  visible: boolean;
  /** Open on the camera (phone) or the paste box. */
  startWithCamera: boolean;
  onDismiss: () => void;
  onInstalled: (tool: CustomTool) => void;
  errorColor: string;
}

export const ToolReceiveDialog: React.FC<ReceiveProps> = ({
  visible,
  startWithCamera,
  onDismiss,
  onInstalled,
  errorColor,
}) => {
  const {hasPermission, requestPermission} = useCameraPermission();
  const [camera, setCamera] = useState(false);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState('');
  const [review, setReview] = useState<ReviewResult | null>(null);
  /** A shared loop read from a code, before it is installed. */
  const [loopReview, setLoopReview] = useState<Loop | null>(null);
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setCamera(false);
    setPasted('');
    setError('');
    setReview(null);
    setLoopReview(null);
    setNewName('');
    setBusy(false);
  };
  const close = () => {
    reset();
    onDismiss();
  };

  const openCamera = async () => {
    setError('');
    let granted = hasPermission;
    if (!granted) {
      granted = !!(await requestPermission());
    }
    if (!granted) {
      setError('Camera permission is needed to scan. You can paste the code.');
      return;
    }
    setCamera(true);
  };

  // Opened from "Scan QR": start the camera (each opening is a fresh mount).
  useEffect(() => {
    if (startWithCamera && canScanWithCamera()) {
      openCamera();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pair = (value: string) => {
    close();
    // The same question and pairing as Settings → Remote model.
    Alert.alert(
      'Pair with your PC?',
      'This device will be able to use the model running on your PC (DesktopAgent), from anywhere. Your PC asks you to allow it too.',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Pair',
          onPress: () => {
            pairHomePc(value).then(result =>
              Alert.alert(
                result.ok ? 'Paired with your PC' : 'Not paired',
                result.message,
              ),
            );
          },
        },
      ],
    );
  };

  /** Any PocketAgent code: a tool or a loop to review, or a pairing. */
  const read = async (value: string) => {
    const text = value.trim();
    setCamera(false);
    setError('');
    const kind = codeKind(text);
    if (kind === 'pairing') {
      pair(text);
      return;
    }
    if (kind === 'loop') {
      const shared = reviewLoopCode(text);
      if (!shared.ok) {
        setError(shared.error);
        return;
      }
      setLoopReview(shared.loop);
      return;
    }
    if (kind !== 'tool') {
      setError(
        'Not a PocketAgent code. Paste a tool code (starts with PA1:T:), a loop code (PA1:L:) or a PC pairing code (PA1:P:).',
      );
      return;
    }
    const result = await reviewToolCode(text);
    if (result.status === 'refused') {
      setError(result.error);
      return;
    }
    setReview(result);
    setNewName(result.tool.name);
  };

  const rename = async () => {
    if (!review || review.status === 'refused') {
      return;
    }
    const result = await reviewSharedTool(
      {...review.tool} as unknown as Record<string, unknown>,
      newName,
    );
    if (result.status === 'refused') {
      setError(result.error);
      return;
    }
    setError('');
    setReview(result);
  };

  const install = async () => {
    if (!review || review.status !== 'ready') {
      return;
    }
    setBusy(true);
    const saved = await installSharedTool(review.tool);
    setBusy(false);
    if (typeof saved === 'string') {
      setError(saved);
      return;
    }
    onInstalled(saved);
    close();
  };

  /** Saves the shared loop paused; the user presses Start on its card. */
  const installLoop = async () => {
    if (!loopReview) {
      return;
    }
    setBusy(true);
    const saved = await installSharedLoop(loopReview);
    setBusy(false);
    if (typeof saved === 'string') {
      setError(saved);
      return;
    }
    close();
    Alert.alert(
      `Installed, not started: ${saved.title}`,
      'It is in Toolbox → Loops, paused. Press Start on its card when you want it to begin.',
    );
  };

  const fromFile = async () => {
    setError('');
    try {
      const text = await readCodeFile();
      if (text !== null) {
        await read(text);
      }
    } catch (e) {
      setError(
        'Could not open the file: ' + String((e as Error)?.message ?? e),
      );
    }
  };

  const fromClipboard = async () => {
    const text = await Clipboard.getString();
    setPasted(text.slice(0, MAX_CODE_CHARS + 1));
  };

  const reviewing = review !== null && review.status !== 'refused';
  const reviewingLoop = loopReview !== null;

  return (
    <Dialog visible={visible} onDismiss={close}>
      <Dialog.Title>
        {reviewingLoop
          ? 'Install a shared loop?'
          : reviewing
            ? 'Install a shared tool?'
            : 'Scan or paste a code'}
      </Dialog.Title>
      <Dialog.ScrollArea>
        <ScrollView
          style={{maxHeight: 480}}
          keyboardShouldPersistTaps="handled">
          {reviewingLoop && loopReview ? (
            <SharedLoopReview loop={loopReview} />
          ) : reviewing && review ? (
            <View testID="tool-receive-review" style={{gap: 6}}>
              <Text variant="bodySmall">
                Check every step. Nothing has run; the tool is installed
                switched off and only does anything after you switch it on.
              </Text>
              <Text
                selectable
                variant="bodySmall"
                testID="tool-receive-definition">
                {describeCustomTool(review.tool)}
              </Text>
              {review.status === 'name_taken' ? (
                <>
                  <Text variant="bodyMedium" style={{color: errorColor}}>
                    {`You already have a tool called "${review.tool.name}". It is kept; give this one another name.`}
                  </Text>
                  <TextInput
                    testID="tool-receive-new-name"
                    label="New name"
                    mode="outlined"
                    autoCapitalize="none"
                    value={newName}
                    onChangeText={setNewName}
                  />
                </>
              ) : null}
            </View>
          ) : (
            <View style={{gap: 6}}>
              {camera ? <CodeCamera onCode={read} /> : null}
              <Text variant="bodySmall">
                {canScanWithCamera()
                  ? 'Scan a PocketAgent QR (a shared tool or loop, or a PC pairing code), or paste the code.'
                  : 'Paste a PocketAgent code (a shared tool or loop, or a PC pairing code) or open a shared file. Scanning needs a phone camera.'}
              </Text>
              <TextInput
                testID="tool-receive-paste"
                label="Paste a code (PA1:…)"
                mode="outlined"
                multiline
                autoCapitalize="none"
                autoCorrect={false}
                value={pasted}
                onChangeText={t => setPasted(t.slice(0, MAX_CODE_CHARS + 1))}
                style={{maxHeight: 160}}
              />
              <View style={{flexDirection: 'row', flexWrap: 'wrap'}}>
                {canScanWithCamera() && !camera ? (
                  <Button
                    compact
                    testID="tool-receive-camera"
                    onPress={openCamera}>
                    Scan QR
                  </Button>
                ) : null}
                <Button compact onPress={fromClipboard}>
                  Paste
                </Button>
                <Button compact testID="tool-receive-file" onPress={fromFile}>
                  Open a file
                </Button>
              </View>
            </View>
          )}
          {error ? (
            <Text testID="tool-receive-error" style={{color: errorColor}}>
              {error}
            </Text>
          ) : null}
        </ScrollView>
      </Dialog.ScrollArea>
      <Dialog.Actions>
        <Button onPress={close}>Cancel</Button>
        {reviewing && review?.status === 'name_taken' ? (
          <Button testID="tool-receive-rename" onPress={rename}>
            Use this name
          </Button>
        ) : null}
        {reviewing && review?.status === 'ready' ? (
          <Button
            testID="tool-receive-install"
            disabled={busy}
            onPress={install}>
            Install (off)
          </Button>
        ) : null}
        {reviewingLoop ? (
          <Button
            testID="loop-receive-install"
            disabled={busy}
            onPress={installLoop}>
            Install (paused)
          </Button>
        ) : null}
        {!reviewing && !reviewingLoop ? (
          <Button
            testID="tool-receive-read"
            disabled={!pasted.trim()}
            onPress={() => read(pasted)}>
            Read code
          </Button>
        ) : null}
      </Dialog.Actions>
    </Dialog>
  );
};

/** Portal wrapper so CustomToolsSection stays small. */
export const ToolCodeDialogs: React.FC<{
  sharing: CustomTool | null;
  onShareDismiss: () => void;
  receiving: null | 'camera' | 'paste';
  /** Changes on every opening, so the receive dialog starts fresh. */
  receiveSession: number;
  onReceiveDismiss: () => void;
  onInstalled: (tool: CustomTool) => void;
  errorColor: string;
}> = ({
  sharing,
  onShareDismiss,
  receiving,
  receiveSession,
  onReceiveDismiss,
  onInstalled,
  errorColor,
}) => (
  <Portal>
    <ToolShareDialog tool={sharing} onDismiss={onShareDismiss} />
    <ToolReceiveDialog
      key={receiveSession}
      visible={receiving !== null}
      startWithCamera={receiving === 'camera'}
      onDismiss={onReceiveDismiss}
      onInstalled={onInstalled}
      errorColor={errorColor}
    />
  </Portal>
);
