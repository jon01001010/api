import * as React from 'react';
import {
  TextInput,
  TextInputProps,
  View,
  Animated,
  TouchableOpacity,
  Alert,
  ScrollView,
  Image,
  Modal,
  FlatList,
} from 'react-native';
import {launchCamera, launchImageLibrary} from 'react-native-image-picker';
import {pick, keepLocalCopy, types, isErrorWithCode, errorCodes} from '@react-native-documents/picker';
import * as RNFS from '@dr.pogodin/react-native-fs';
import Share from 'react-native-share';
import {importWorkspaceCopy, normalizeImportName, isEditableTextName, MAX_FILE_BYTES, MAX_IMPORT_BYTES, checkText, ensureWorkspace, FILE_ROOT, safeWorkspaceName, workspacePath} from '../../services/talents/fileWorkspace';
import {useCameraPermission} from 'react-native-vision-camera';
import ReactNativeHapticFeedback from 'react-native-haptic-feedback';

import {observer} from 'mobx-react';
import {IconButton, Text} from 'react-native-paper';

import {hasVideoCapability} from '../../utils/pal-capabilities';

import {
  ChevronUpIcon,
  VideoRecorderIcon,
  PlusIcon,
  AtomIcon,
} from '../../assets/icons';

import {useTheme} from '../../hooks';

import {createStyles} from './styles';

import {chatSessionStore, modelStore, palStore, uiStore} from '../../store';

import {MessageType} from '../../utils/types';
import {L10nContext, UserContext} from '../../utils';
import {t} from '../../locales';

import {SendButton, StopButton, Menu, VoiceChip} from '..';

export interface ChatInputTopLevelProps {
  /** Whether the AI is currently streaming tokens */
  isStreaming?: boolean;
  /** Will be called on {@link SendButton} tap. Has {@link MessageType.PartialText} which can
   * be transformed to {@link MessageType.Text} and added to the messages list. */
  onSendPress: (message: MessageType.PartialText) => void;
  onStopPress?: () => void;
  onCancelEdit?: () => void;
  onPalBtnPress?: () => void;
  isStopVisible?: boolean;
  /** Controls the visibility behavior of the {@link SendButton} based on the
   * `TextInput` state. Defaults to `editing`. */
  sendButtonVisibilityMode?: 'always' | 'editing';
  textInputProps?: TextInputProps;
  isPickerVisible?: boolean;
  inputBackgroundColor?: string;
  /** External control for selected images (for edit mode) */
  defaultImages?: string[];
  onDefaultImagesChange?: (images: string[]) => void;

  /** Camera-specific props */
  isCameraActive?: boolean;
  onStartCamera?: () => void;
  /** For camera input, allows direct editing of the prompt text */
  promptText?: string;
  onPromptTextChange?: (text: string) => void;
  /** Whether to show the image upload button */
  showImageUpload?: boolean;
  isVisionEnabled?: boolean;
  /** Whether to show the thinking toggle button */
  showThinkingToggle?: boolean;
  /** Whether thinking mode is currently enabled */
  isThinkingEnabled?: boolean;
  /** Callback when thinking toggle is pressed */
  onThinkingToggle?: (enabled: boolean) => void;
  /** Whether the model supports graded reasoning effort (axis 2) */
  supportsEffort?: boolean;
  /** The graded effort value set, e.g. ['low','medium','high'] */
  effortValues?: string[];
  /** Currently selected reasoning effort (when graded) */
  reasoningEffort?: string;
  /** Callback to cycle the graded effort state (off -> values -> off) */
  onEffortCycle?: () => void;
}

export interface ChatInputAdditionalProps {
  /** Camera-specific props */
  isCameraActive?: boolean;
  onStartCamera?: () => void;
  /** For camera input, allows direct editing of the prompt text */
  promptText?: string;
  onPromptTextChange?: (text: string) => void;
  /** Whether to show the image upload button */
  showImageUpload?: boolean;
  /** Whether to show the thinking toggle button */
  showThinkingToggle?: boolean;
  /** Whether thinking mode is currently enabled */
  isThinkingEnabled?: boolean;
  /** Callback when thinking toggle is pressed */
  onThinkingToggle?: (enabled: boolean) => void;
  /** Whether the model supports graded reasoning effort (axis 2) */
  supportsEffort?: boolean;
  /** The graded effort value set, e.g. ['low','medium','high'] */
  effortValues?: string[];
  /** Currently selected reasoning effort (when graded) */
  reasoningEffort?: string;
  /** Callback to cycle the graded effort state (off -> values -> off) */
  onEffortCycle?: () => void;
}

export type ChatInputProps = ChatInputTopLevelProps & ChatInputAdditionalProps;

const hapticOptions = {
  enableVibrateFallback: true,
  ignoreAndroidSystemSettings: false,
};

/** Bottom bar input component with a text input, attachment and
 * send buttons inside. By default hides send button when text input is empty. */
export const ChatInput = observer(
  ({
    isStreaming = false,
    onSendPress,
    onStopPress,
    onCancelEdit,
    onPalBtnPress,
    isStopVisible,
    sendButtonVisibilityMode,
    textInputProps,
    isPickerVisible,
    inputBackgroundColor,
    isCameraActive = false,
    onStartCamera,
    promptText,
    onPromptTextChange,
    showImageUpload = false,
    isVisionEnabled = false,
    defaultImages,
    onDefaultImagesChange,
    showThinkingToggle = false,
    isThinkingEnabled = false,
    onThinkingToggle,
    supportsEffort = false,
    effortValues = [],
    reasoningEffort,
    onEffortCycle,
  }: ChatInputProps) => {
    const l10n = React.useContext(L10nContext);
    const theme = useTheme();
    const user = React.useContext(UserContext);
    const inputRef = React.useRef<TextInput>(null);
    const editBarHeight = React.useRef(new Animated.Value(0)).current;
    const iconRotation = React.useRef(new Animated.Value(0)).current;
    const activePalId = chatSessionStore.activePalId;
    const currentActivePal = palStore.pals.find(pal => pal.id === activePalId);

    // Camera permission hook from react-native-vision-camera
    const {hasPermission, requestPermission} = useCameraPermission();

    const hasActiveModel = !!modelStore.activeModelId;

    // Use `defaultValue` if provided
    const [text, setText] = React.useState(textInputProps?.defaultValue ?? '');
    // State for selected images - use external control when provided
    const [internalSelectedImages, setInternalSelectedImages] = React.useState<
      string[]
    >([]);
    const selectedImages = defaultImages ?? internalSelectedImages;
    const setSelectedImages =
      onDefaultImagesChange ?? setInternalSelectedImages;
    // State for image upload menu
    const [showImageUploadMenu, setShowImageUploadMenu] = React.useState(false);
    const [workspaceVisible, setWorkspaceVisible] = React.useState(false);
    const [workspaceFiles, setWorkspaceFiles] = React.useState<{name: string; size: number}[]>([]);
    // State for showing "model not loaded" helper text
    const [showModelWarning, setShowModelWarning] = React.useState(false);
    const isEditMode = chatSessionStore.isEditMode;
    const isStopping = chatSessionStore.isStopping;

    const styles = createStyles({theme, isEditMode});

    // For camera input, use promptText if provided
    const isVideoCapable =
      currentActivePal && hasVideoCapability(currentActivePal);
    const value =
      isVideoCapable && promptText !== undefined
        ? promptText
        : (textInputProps?.value ?? text);

    React.useEffect(() => {
      if (isEditMode) {
        // Animate edit bar height
        Animated.spring(editBarHeight, {
          toValue: 28,
          useNativeDriver: false,
          friction: 8,
        }).start();
        // Focus input
        inputRef.current?.focus();
      } else {
        Animated.spring(editBarHeight, {
          toValue: 0,
          useNativeDriver: false,
          friction: 8,
        }).start();
        onCancelEdit?.();
      }
    }, [isEditMode, editBarHeight, onCancelEdit]);

    React.useEffect(() => {
      Animated.spring(iconRotation, {
        toValue: isPickerVisible ? 1 : 0,
        useNativeDriver: true,
        friction: 8,
      }).start();
    }, [isPickerVisible, iconRotation]);

    const handleChangeText = (newText: string) => {
      if (isVideoCapable && onPromptTextChange) {
        onPromptTextChange(newText);
      } else {
        setText(newText);
        textInputProps?.onChangeText?.(newText);
      }
    };

    const handleSend = () => {
      const trimmedValue = value.trim();
      if (trimmedValue) {
        // Check if model is loaded before sending
        if (!hasActiveModel) {
          // Trigger haptic feedback to indicate the action is blocked
          ReactNativeHapticFeedback.trigger(
            'notificationWarning',
            hapticOptions,
          );
          // Show warning helper text
          setShowModelWarning(true);
          // Auto-hide after 3 seconds
          setTimeout(() => setShowModelWarning(false), 3000);
          return;
        }

        // Include imageUris in the message object
        onSendPress({
          text: trimmedValue,
          type: 'text',
          imageUris: selectedImages.length > 0 ? selectedImages : undefined,
        });
        setText('');
        // Clear selected images after sending
        setSelectedImages([]);
      }
    };

    // Handle plus button press to show image upload menu
    const handlePlusButtonPress = () => {
      setShowImageUploadMenu(true);
    };

    // Need to figure this out:
    // Handle taking a photo with the camera using react-native-image-picker
    // but with permission checking from react-native-vision-camera
    const handleTakePhoto = async () => {
      try {
        if (!hasPermission) {
          const permissionResult = await requestPermission();
          if (!permissionResult) {
            Alert.alert(
              l10n.camera.permissionTitle,
              l10n.camera.permissionMessage,
            );
            setShowImageUploadMenu(false);
            return;
          }
        }

        // Disable auto-release during camera operation
        // this is only needed on Android.
        modelStore.disableAutoRelease('camera-photo');

        const result = await launchCamera({
          mediaType: 'photo',
          quality: 0.8,
        });

        if (result.errorCode === 'camera_unavailable') {
          Alert.alert(l10n.camera.errorTitle, l10n.camera.noDevice);
        } else if (result.errorCode) {
          Alert.alert(
            l10n.errors.cameraErrorTitle,
            l10n.errors.cameraErrorMessage,
          );
        } else if (
          result.assets &&
          result.assets.length > 0 &&
          result.assets[0].uri
        ) {
          const newImages = [...selectedImages, result.assets[0].uri];
          setSelectedImages(newImages);
        }
        setShowImageUploadMenu(false);
      } catch (error) {
        console.error('Error taking photo:', error);
        Alert.alert(
          l10n.errors.cameraErrorTitle,
          l10n.errors.cameraErrorMessage,
        );
      } finally {
        // Re-enable auto-release after camera operation
        modelStore.enableAutoRelease('camera-photo');
      }
    };

    // Handle selecting images from the gallery
    const handleSelectImages = async () => {
      try {
        // Disable auto-release during gallery operation
        // this is only needed on Android.
        modelStore.disableAutoRelease('image-gallery');

        const result = await launchImageLibrary({
          mediaType: 'photo',
          selectionLimit: 5, // Allow multiple images
          quality: 0.8,
        });

        if (result.assets && result.assets.length > 0) {
          const newUris = result.assets
            .filter(asset => asset.uri)
            .map(asset => asset.uri as string);

          if (newUris.length > 0) {
            const newImages = [...selectedImages, ...newUris];
            setSelectedImages(newImages);
          }
        }
        setShowImageUploadMenu(false);
      } catch (error) {
        console.error('Error selecting images:', error);
        Alert.alert(
          l10n.errors.galleryErrorTitle,
          l10n.errors.galleryErrorMessage,
        );
      } finally {
        // Re-enable auto-release after gallery operation
        modelStore.enableAutoRelease('image-gallery');
      }
    };

    // SAF picker: no blanket storage permission and no tool execution.
    // This text-only import is intentionally bounded until format-aware
    // editors and the full user-approved file-write flow are integrated.
    const handleSelectFile = async () => {
      setShowImageUploadMenu(false);
      let tempPath: string | undefined;
      try {
        const selection = await pick({
          type: [types.allFiles],
          allowMultiSelection: false,
        });
        const file = selection[0];
        if (!file?.uri) return;
        const requestedName = normalizeImportName(file.name || 'document.bin');
        if (file.size != null && Number(file.size) > MAX_IMPORT_BYTES) {
          throw new Error('This file exceeds the 32 MiB import limit.');
        }
        const [copy] = await keepLocalCopy({
          files: [{uri: file.uri, fileName: requestedName}],
          destination: 'cachesDirectory',
        });
        if (!copy || copy.status !== 'success') {
          throw new Error(copy?.status === 'error'
            ? 'Android could not copy this document: ' + copy.copyError
            : 'Android did not return a local copy');
        }
        // keepLocalCopy returns a file:// URI, whereas RNFS expects a path.
        tempPath = decodeURIComponent(copy.localUri.replace(/^file:\/\//, ''));
        const info = await RNFS.stat(tempPath);
        const fileSize = Number(info.size);
        if (!info.isFile() || !Number.isFinite(fileSize) || fileSize > MAX_IMPORT_BYTES) {
          throw new Error('Not a regular file, or exceeds the 32 MiB import limit.');
        }

        const isText = isEditableTextName(requestedName);
        let content: string | undefined;
        if (isText) {
          if (fileSize > MAX_FILE_BYTES) {
            throw new Error('Text/code files currently have a 16 KiB limit.');
          }
          content = checkText(await RNFS.readFile(tempPath, 'utf8'));
          if (content.includes('\0')) {
            throw new Error('The selected file contains binary data rather than text.');
          }
        }
        // Save an independent workspace copy, never replace the Android original.
        // A duplicate filename gets an incremented suffix.
        const storedName = await importWorkspaceCopy(requestedName, tempPath, fileSize);
        const imported = isText
          ? `[User-selected text file saved in PocketAgentFiles: ${storedName}]\n${content}\n[End of file]\nTo edit and save this copy, enable file_read and file_edit in Toolbox.`
          : `[User-selected binary file saved in PocketAgentFiles: ${storedName}; ${fileSize} bytes]\nThis file is stored, but the model needs format-specific tools to inspect or edit its binary contents.`;
        handleChangeText(`${value}${value ? '\n\n' : ''}${imported}`);
        if (!isText) {
          Alert.alert('File imported',
            `${storedName} was saved in the PocketAgent workspace. Binary editing is not supported yet. For image analysis with a vision model, use Gallery.`);
        }
      } catch (error) {
        if (isErrorWithCode(error) && error.code === errorCodes.OPERATION_CANCELED) return;
        const detail = error instanceof Error ? error.message : String(error);
        console.warn('Document selection failed', error);
        Alert.alert('File import failed', detail.slice(0, 320) || 'Unable to import the selected file.');
      } finally {
        if (tempPath) await RNFS.unlink(tempPath).catch(() => undefined);
      }
    };

    const openWorkspace = async () => {
      setShowImageUploadMenu(false);
      try {
        await ensureWorkspace();
        const entries = await RNFS.readDir(FILE_ROOT);
        const files = entries.filter(entry => entry.isFile()).map(entry => ({
          name: entry.name,
          size: Number(entry.size),
        })).filter(entry => {
          try { safeWorkspaceName(entry.name); return true; } catch { return false; }
        });
        setWorkspaceFiles(files.sort((a, b) => a.name.localeCompare(b.name)));
        setWorkspaceVisible(true);
      } catch (error) {
        Alert.alert('Workspace unavailable', error instanceof Error ? error.message : String(error));
      }
    };

    const shareWorkspaceFile = async (name: string) => {
      try {
        const path = workspacePath(name);
        const info = await RNFS.stat(path);
        if (!info.isFile()) throw new Error('File is not available');
        // Share all workspace files using the same cached-file path as PNGs.
        // The data: URI path fails on some Android share targets with a null URI.
        const mime = isEditableTextName(name) ? 'text/plain' :
          name.toLowerCase().endsWith('.png') ? 'image/png' : 'application/octet-stream';
        const cachePath = RNFS.CachesDirectoryPath + '/' + name;
        if (await RNFS.exists(cachePath)) await RNFS.unlink(cachePath);
        await RNFS.copyFile(path, cachePath);
        await Share.open({
          url: 'file://' + cachePath,
          filename: name,
          title: 'Save or share ' + name,
          type: mime,
          failOnCancel: false,
        });
      } catch (error) {
        Alert.alert('Export failed', error instanceof Error ? error.message : String(error));
      }
    };

    // Remove an image from the selection
    const handleRemoveImage = (index: number) => {
      const newImages = [...selectedImages];
      newImages.splice(index, 1);
      setSelectedImages(newImages);
    };

    const handleCancel = () => {
      setText('');
      onCancelEdit?.();
    };

    const isSendButtonVisible =
      !isStreaming &&
      !isStopVisible &&
      user &&
      !isVideoCapable && // Hide send button for video-capable pals
      (sendButtonVisibilityMode === 'always' || value.trim());
    const isSendButtonEnabled =
      value.trim().length > 0 && hasActiveModel && !isStopping;
    const sendButtonOpacity = isSendButtonEnabled ? 1 : 0.4;

    const rotateInterpolate = iconRotation.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '180deg'],
    });

    const onSurfaceColor = currentActivePal?.color?.[0] || theme.colors.text;
    const onSurfaceColorVariant = onSurfaceColor + '55'; // for disabled state or placeholder text
    // // Plus button state
    const isPlusButtonEnabled = !isStreaming && hasActiveModel;
    const plusColor = isPlusButtonEnabled
      ? onSurfaceColor
      : onSurfaceColorVariant;

    // Localize the current graded-effort tier through the same table the
    // model-settings chips use; fall back to the raw token for an unlisted one.
    const effortLevelLabels = l10n.components.modelSettingsSheet.effortLevels;
    const localizedEffort =
      reasoningEffort && reasoningEffort in effortLevelLabels
        ? effortLevelLabels[reasoningEffort as keyof typeof effortLevelLabels]
        : reasoningEffort;

    return (
      <View style={styles.container}>
        <Modal
          visible={workspaceVisible}
          transparent
          animationType="slide"
          onRequestClose={() => setWorkspaceVisible(false)}>
          <View style={{flex: 1, justifyContent: 'center', padding: 20, backgroundColor: 'rgba(0,0,0,0.55)'}}>
            <View style={{backgroundColor: theme.colors.surface, borderRadius: 16, padding: 16, maxHeight: '75%'}}>
              <Text variant="titleMedium">PocketAgent workspace</Text>
              <Text variant="bodySmall" style={{marginVertical: 10}}>
                Tap a file to share it or save a copy using Android's share sheet.
              </Text>
              <FlatList
                data={workspaceFiles}
                keyExtractor={item => item.name}
                ListEmptyComponent={<Text>No workspace files yet.</Text>}
                renderItem={({item}) => (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={'Share ' + item.name}
                    onPress={() => shareWorkspaceFile(item.name)}
                    style={{paddingVertical: 12, borderBottomWidth: 1, borderColor: theme.colors.outlineVariant}}>
                    <Text>{item.name}</Text>
                    <Text variant="bodySmall">{item.size} bytes · Share / Save</Text>
                  </TouchableOpacity>
                )}
              />
              <TouchableOpacity onPress={() => setWorkspaceVisible(false)} style={{alignSelf: 'flex-end', padding: 12}}>
                <Text>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
        <View style={styles.inputContainer}>
          {/* Edit Bar (when in edit mode) */}
          {isEditMode && (
            <Animated.View
              style={[
                styles.editBar,
                {
                  height: editBarHeight,
                },
              ]}>
              <Text variant="labelSmall" style={styles.editBarText}>
                Editing message
              </Text>
              <IconButton
                icon="close"
                size={16}
                onPress={handleCancel}
                style={styles.editBarButton}
                iconColor={theme.colors.onSurfaceVariant}
              />
            </Animated.View>
          )}

          {/* Image Preview Section */}
          {selectedImages.length > 0 && (
            <View
              style={[
                styles.imagePreviewContainer,
                isEditMode && styles.imagePreviewContainerEditMode,
              ]}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.imageScrollContent}>
                {selectedImages.map((uri, index) => (
                  <View key={`${uri}-${index}`} style={styles.imageContainer}>
                    <Image
                      source={{uri}}
                      style={styles.previewImage}
                      accessibilityLabel={`Image preview ${index + 1} of ${
                        selectedImages.length
                      }`}
                    />
                    <IconButton
                      icon="close-circle"
                      size={20}
                      iconColor={theme.colors.error}
                      style={styles.removeImageButton}
                      onPress={() => handleRemoveImage(index)}
                      accessibilityLabel={`Remove image ${index + 1}`}
                    />
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Text Input Area (Top Row) */}
          <View
            style={[
              styles.textInputArea,
              {
                paddingTop: isEditMode
                  ? selectedImages.length > 0
                    ? 8 // Reduced padding when images present in edit mode
                    : 48 // Edit bar height (28px) + normal padding (20px)
                  : selectedImages.length > 0
                    ? 0
                    : 20,
              },
            ]}>
            {/* Subtle Prompt Label for Video Pals */}
            {isVideoCapable && (
              <Text
                variant="labelSmall"
                style={[styles.promptLabel, {color: onSurfaceColorVariant}]}>
                {l10n.palsScreen.prompt}:
              </Text>
            )}
            <TextInput
              ref={inputRef}
              multiline
              placeholder={
                isVideoCapable
                  ? l10n.video.promptPlaceholder
                  : l10n.components.chatInput.inputPlaceholder
              }
              placeholderTextColor={onSurfaceColorVariant}
              underlineColorAndroid="transparent"
              {...textInputProps}
              style={[
                styles.input,
                textInputProps?.style,
                {
                  color: onSurfaceColor,
                },
                isVideoCapable && styles.inputWithLabel,
              ]}
              onChangeText={handleChangeText}
              value={value}
              editable={
                isVideoCapable
                  ? !isStreaming && !isCameraActive
                  : textInputProps?.editable !== false
              }
              testID="chat-input"
              accessibilityLabel="Message input"
            />
          </View>

          {/* Control Bar (Bottom Row) */}
          <View style={styles.controlBar}>
            {/* Left Controls */}
            <View style={styles.leftControls}>
              {/* Plus Button for Image Upload (only for regular chat) */}
              {(showImageUpload || hasActiveModel) && !isVideoCapable && (
                <Menu
                  visible={showImageUploadMenu}
                  onDismiss={() => setShowImageUploadMenu(false)}
                  anchorPosition="top"
                  anchor={
                    <TouchableOpacity
                      style={styles.plusButton}
                      disabled={!isPlusButtonEnabled}
                      onPress={
                        isPlusButtonEnabled ? handlePlusButtonPress : () => {}
                      }
                      accessibilityLabel="Add attachment"
                      accessibilityRole="button">
                      <PlusIcon width={20} height={20} stroke={plusColor} />
                    </TouchableOpacity>
                  }>
                  {isVisionEnabled && (
                    <Menu.Item
                      label={l10n.camera?.takePhoto || 'Camera'}
                      icon="camera"
                      onPress={handleTakePhoto}
                    />
                  )}
                  {isVisionEnabled && (
                    <Menu.Item
                      label={l10n.common?.gallery || 'Gallery'}
                      icon="image"
                      onPress={handleSelectImages}
                    />
                  )}
                  <Menu.Item
                    label="Workspace files / Share"
                    icon="folder-outline"
                    onPress={openWorkspace}
                  />
                  <Menu.Item
                    label="Files"
                    icon="file-document-outline"
                    onPress={handleSelectFile}
                  />
                </Menu>
              )}

              {/* Pal Selector */}
              <View style={styles.palSelector}>
                <TouchableOpacity
                  style={[
                    styles.palBtn,
                    {
                      backgroundColor:
                        uiStore.colorScheme === 'dark'
                          ? theme.colors.inverseOnSurface
                          : theme.colors.inverseSurface,
                    },
                    currentActivePal?.color && {
                      backgroundColor: currentActivePal?.color?.[0],
                    },
                  ]}
                  onPress={onPalBtnPress}
                  accessibilityLabel="Select Pal"
                  accessibilityRole="button">
                  <Animated.View
                    style={{
                      transform: [{rotate: rotateInterpolate}],
                    }}>
                    <ChevronUpIcon stroke={inputBackgroundColor} />
                  </Animated.View>
                </TouchableOpacity>

                {/* Pal Name Display */}
                {currentActivePal?.name && hasActiveModel && (
                  <Text
                    style={[
                      styles.palNameCompact,
                      {
                        color: onSurfaceColor,
                      },
                    ]}>
                    Pal:{' '}
                    <Text
                      style={[
                        styles.palNameValueCompact,
                        {
                          color: onSurfaceColor,
                        },
                      ]}>
                      {currentActivePal?.name}
                    </Text>
                  </Text>
                )}
              </View>

              {/* Thinking Toggle Button. Graded models (axis-2) cycle
                  off -> low -> medium -> high; effortless models toggle
                  on/off. The label shows the current effort when graded. */}
              {showThinkingToggle && !isCameraActive && (
                <TouchableOpacity
                  testID="thinking-toggle"
                  style={[
                    styles.thinkingToggleLeft,
                    isThinkingEnabled && {backgroundColor: onSurfaceColor},
                    {borderColor: onSurfaceColorVariant},
                  ]}
                  onPress={() =>
                    supportsEffort && effortValues.length > 0
                      ? onEffortCycle?.()
                      : onThinkingToggle?.(!isThinkingEnabled)
                  }
                  accessibilityLabel={
                    supportsEffort && effortValues.length > 0
                      ? t(
                          l10n.components.chatInput.thinkingToggle.cycleEffort,
                          {
                            level: localizedEffort ?? '',
                          },
                        )
                      : isThinkingEnabled
                        ? l10n.components.chatInput.thinkingToggle
                            .disableThinking
                        : l10n.components.chatInput.thinkingToggle
                            .enableThinking
                  }
                  accessibilityRole="button">
                  <AtomIcon
                    width={14}
                    height={14}
                    stroke={
                      isThinkingEnabled
                        ? inputBackgroundColor
                        : onSurfaceColorVariant
                    }
                    strokeWidth={2}
                  />
                  <Text
                    style={[
                      styles.thinkingToggleText,
                      isThinkingEnabled
                        ? {color: inputBackgroundColor}
                        : {color: onSurfaceColorVariant},
                    ]}>
                    {supportsEffort && isThinkingEnabled && reasoningEffort
                      ? localizedEffort
                      : l10n.components.chatInput.thinkingToggle.thinkText}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            {/* Right Controls */}
            <View style={styles.rightControls}>
              {/* Helper text for model not loaded */}
              {showModelWarning && !hasActiveModel && (
                <View style={styles.helperTextContainer}>
                  <Text variant="bodySmall" style={styles.helperText}>
                    {l10n.chat.cannotSendWithoutModel}
                  </Text>
                </View>
              )}

              {/* Voice chip (TTS) — always present so users can stop
                  audio independently of text generation. Self-gates:
                  returns null when TTS is unavailable. */}
              <VoiceChip />

              {/* Send/Stop Button */}
              {isStopVisible ? (
                <StopButton color={onSurfaceColor} onPress={onStopPress} />
              ) : isVideoCapable && !isCameraActive ? (
                /* Compact Start Video Button for Video Pals */
                <TouchableOpacity
                  style={[
                    styles.compactVideoButton,
                    {
                      backgroundColor: onSurfaceColor,
                    },
                  ]}
                  onPress={onStartCamera}
                  accessibilityLabel="Start video analysis"
                  accessibilityRole="button">
                  <VideoRecorderIcon
                    width={16}
                    height={16}
                    stroke="white"
                    strokeWidth={2}
                  />
                  <Text style={styles.compactButtonText}>
                    {l10n.video.startCamera}
                  </Text>
                </TouchableOpacity>
              ) : (
                isSendButtonVisible && (
                  <View style={{opacity: sendButtonOpacity}}>
                    <SendButton
                      color={onSurfaceColor}
                      onPress={handleSend}
                      touchableOpacityProps={{
                        disabled: isStopping,
                        accessibilityState: {disabled: isStopping},
                      }}
                    />
                  </View>
                )
              )}
            </View>
          </View>
        </View>
      </View>
    );
  },
);
