import React, {useContext, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {observer} from 'mobx-react';
import {
  ActivityIndicator,
  Button,
  Switch,
  Text,
  TouchableRipple,
} from 'react-native-paper';

import {Sheet} from '../Sheet';
import {useTheme} from '../../hooks';
import {hfStore, uiStore, voiceStore} from '../../store';
import {L10nContext} from '../../utils';
import {t} from '../../locales';
import {disableWake, enableWake} from '../../services/voice/wakeWord';
import {
  RECOMMENDED_WHISPER,
  searchWhisperModels,
  whisperModelId,
  type WhisperModelRef,
  type WhisperSearchResult,
} from '../../services/voice/whisperModels';

/** Uploaders whose Whisper files are widely used. Others get a caution. */
const KNOWN_AUTHORS = ['ggerganov', 'ggml-org'];

const formatSize = (bytes?: number) =>
  bytes ? `${Math.round(bytes / 1e6)} MB` : '';

/**
 * Voice input settings: the speech-to-text model (any Whisper GGML model
 * from Hugging Face), and conversation mode.
 */
export const VoiceInputSheet: React.FC = observer(() => {
  const l10n = useContext(L10nContext);
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<WhisperSearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [phrase, setPhrase] = useState(voiceStore.wakePhrase);

  const toggleWake = (on: boolean) => {
    (on ? enableWake() : disableWake()).catch(() => {});
  };
  const savePhrase = () => {
    voiceStore.setWakePhrase(phrase);
    setPhrase(voiceStore.wakePhrase);
    if (voiceStore.wakeEnabled) {
      // Restart so the notification shows the new phrase.
      enableWake().catch(() => {});
    }
  };

  const selectedId = voiceStore.selectedModel
    ? whisperModelId(voiceStore.selectedModel)
    : null;

  const runSearch = async () => {
    setSearching(true);
    setSearchError(false);
    try {
      setResults(await searchWhisperModels(query, hfStore.hfToken));
    } catch {
      setSearchError(true);
      setResults(null);
    } finally {
      setSearching(false);
    }
  };

  const download = (m: WhisperModelRef) => {
    voiceStore.download(m, hfStore.hfToken).catch(() =>
      uiStore.setChatWarning({
        code: 'network',
        message: l10n.voiceAndSpeech.voiceInput.downloadFailed,
        context: 'chat',
        recoverable: true,
        severity: 'warning',
      } as any),
    );
  };

  const downloadButton = (m: WhisperModelRef, testID: string) => {
    const id = whisperModelId(m);
    const progress = voiceStore.downloads[id];
    if (progress !== undefined) {
      return (
        <Text style={styles.meta} testID={`${testID}-progress`}>
          {t(l10n.voiceAndSpeech.voiceInput.downloading, {
            percent: Math.round(progress * 100),
          })}
        </Text>
      );
    }
    if (voiceStore.isDownloaded(m)) {
      return null;
    }
    return (
      <Button
        compact
        mode="outlined"
        testID={testID}
        onPress={() => download(m)}>
        {l10n.voiceAndSpeech.voiceInput.download}
      </Button>
    );
  };

  const muted = {color: theme.colors.onSurfaceVariant};

  return (
    <Sheet
      isVisible={voiceStore.isSheetOpen}
      onClose={() => voiceStore.closeSheet()}
      title={l10n.voiceAndSpeech.voiceInput.sheetTitle}
      snapPoints={['85%']}>
      <Sheet.ScrollView contentContainerStyle={styles.content}>
        <Text style={[styles.intro, muted]}>
          {l10n.voiceAndSpeech.voiceInput.sheetIntro}
        </Text>

        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>
              {l10n.voiceAndSpeech.voiceInput.conversationMode}
            </Text>
            <Text style={[styles.meta, muted]}>
              {l10n.voiceAndSpeech.voiceInput.conversationModeHint}
            </Text>
          </View>
          <Switch
            testID="voice-conversation-switch"
            value={voiceStore.conversationMode}
            onValueChange={v => voiceStore.setConversationMode(v)}
          />
        </View>
        <View style={styles.row}>
          <View style={styles.rowText}>
            <Text style={styles.label}>
              {l10n.voiceAndSpeech.voiceInput.wakeWord}
            </Text>
            <Text style={[styles.meta, muted]}>
              {l10n.voiceAndSpeech.voiceInput.wakeWordHint}
            </Text>
          </View>
          <Switch
            testID="voice-wake-switch"
            value={voiceStore.wakeEnabled}
            onValueChange={toggleWake}
          />
        </View>
        <View style={styles.searchRow}>
          <Text style={[styles.meta, muted]}>
            {l10n.voiceAndSpeech.voiceInput.wakePhrase}
          </Text>
          <Sheet.TextInput
            testID="voice-wake-phrase"
            style={[
              styles.searchInput,
              {
                color: theme.colors.onSurface,
                borderColor: theme.colors.outline,
              },
            ]}
            value={phrase}
            onChangeText={setPhrase}
            onEndEditing={savePhrase}
            onSubmitEditing={savePhrase}
            autoCorrect={false}
          />
        </View>

        <Text style={styles.heading}>
          {l10n.voiceAndSpeech.voiceInput.yourModels}
        </Text>
        {voiceStore.models.length === 0 ? (
          <Text style={[styles.meta, muted]}>
            {l10n.voiceAndSpeech.voiceInput.noModels}
          </Text>
        ) : (
          voiceStore.models.map(m => {
            const id = whisperModelId(m);
            const inUse = id === selectedId;
            return (
              <View key={id} style={styles.row} testID={`voice-model-${id}`}>
                <View style={styles.rowText}>
                  <Text style={styles.label}>{m.file}</Text>
                  <Text style={[styles.meta, muted]}>
                    {m.repo} · {formatSize(m.size)}
                  </Text>
                </View>
                {inUse ? (
                  <Text style={styles.meta}>
                    {l10n.voiceAndSpeech.voiceInput.inUse}
                  </Text>
                ) : (
                  <Button compact onPress={() => voiceStore.selectModel(m)}>
                    {l10n.voiceAndSpeech.voiceInput.use}
                  </Button>
                )}
                <Button
                  compact
                  testID={`voice-delete-${id}`}
                  onPress={() => voiceStore.remove(m).catch(() => {})}>
                  {l10n.voiceAndSpeech.voiceInput.delete}
                </Button>
              </View>
            );
          })
        )}

        {!voiceStore.isDownloaded(RECOMMENDED_WHISPER) ? (
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.label}>
                {l10n.voiceAndSpeech.voiceInput.recommended}:{' '}
                {RECOMMENDED_WHISPER.file}
              </Text>
              <Text style={[styles.meta, muted]}>
                {RECOMMENDED_WHISPER.repo}
              </Text>
            </View>
            {downloadButton(RECOMMENDED_WHISPER, 'voice-download-recommended')}
          </View>
        ) : null}

        <Text style={styles.heading}>
          {l10n.voiceAndSpeech.voiceInput.findModels}
        </Text>
        <View style={styles.searchRow}>
          <Sheet.TextInput
            testID="voice-search-input"
            style={[
              styles.searchInput,
              {
                color: theme.colors.onSurface,
                borderColor: theme.colors.outline,
              },
            ]}
            value={query}
            onChangeText={setQuery}
            placeholder={l10n.voiceAndSpeech.voiceInput.searchPlaceholder}
            placeholderTextColor={theme.colors.onSurfaceVariant}
            autoCorrect={false}
            autoCapitalize="none"
            onSubmitEditing={runSearch}
          />
          <Button
            mode="outlined"
            testID="voice-search-button"
            onPress={runSearch}
            disabled={searching}>
            {l10n.voiceAndSpeech.voiceInput.search}
          </Button>
        </View>
        {searching ? <ActivityIndicator style={styles.spinner} /> : null}
        {searchError ? (
          <Text style={[styles.meta, muted]}>
            {l10n.voiceAndSpeech.voiceInput.searchFailed}
          </Text>
        ) : null}
        {results && results.length === 0 ? (
          <Text style={[styles.meta, muted]}>
            {l10n.voiceAndSpeech.voiceInput.noResults}
          </Text>
        ) : null}
        {(results ?? []).map(r => {
          const id = whisperModelId(r);
          const author = r.repo.split('/')[0];
          const known = KNOWN_AUTHORS.includes(author);
          return (
            <TouchableRipple key={id} testID={`voice-result-${id}`}>
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.label}>{r.file}</Text>
                  <Text style={[styles.meta, muted]}>
                    {[r.repo, formatSize(r.size)].filter(Boolean).join(' · ')}
                  </Text>
                  {!known ? (
                    <Text style={[styles.meta, {color: theme.colors.error}]}>
                      {t(l10n.voiceAndSpeech.voiceInput.unknownAuthor, {
                        author,
                      })}
                    </Text>
                  ) : null}
                </View>
                {downloadButton(r, `voice-download-${id}`)}
              </View>
            </TouchableRipple>
          );
        })}
      </Sheet.ScrollView>
    </Sheet>
  );
});

const styles = StyleSheet.create({
  content: {paddingHorizontal: 16, paddingBottom: 32},
  intro: {fontSize: 14, lineHeight: 20, marginBottom: 12},
  heading: {fontSize: 15, fontWeight: '600', marginTop: 20, marginBottom: 6},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
  },
  rowText: {flex: 1},
  label: {fontSize: 14},
  meta: {fontSize: 12, marginTop: 2},
  searchRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  searchInput: {
    flex: 1,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  spinner: {marginTop: 12},
});
