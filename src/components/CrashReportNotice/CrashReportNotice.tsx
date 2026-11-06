import React, {useContext, useEffect, useState} from 'react';
import {ScrollView, StyleSheet} from 'react-native';
import {Text} from 'react-native-paper';
import Clipboard from '@react-native-clipboard/clipboard';

import {Dialog} from '../Dialog';
import {useTheme} from '../../hooks';
import {L10nContext} from '../../utils';
import {
  loadCrashReports,
  takeNewCrashReports,
  type CrashReport,
} from '../../services/diagnostics/crashReports';

interface Props {
  /** Show this list instead of checking for new ones (Settings). */
  reports?: CrashReport[];
  visible?: boolean;
  onClose?: () => void;
}

/**
 * "PocketAgent closed unexpectedly": why (from Android or the saved app
 * error), with Copy details. Shown once after a crash, or from Settings.
 */
export const CrashReportNotice: React.FC<Props> = ({
  reports: given,
  visible: givenVisible,
  onClose,
}) => {
  const l10n = useContext(L10nContext);
  const theme = useTheme();
  const t = l10n.settings.crashReports;
  const [fresh, setFresh] = useState<CrashReport[]>([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (given) {
      return;
    }
    takeNewCrashReports()
      .then(setFresh)
      .catch(() => {});
  }, [given]);

  const reports = given ?? fresh;
  const visible = givenVisible ?? fresh.length > 0;
  const close = () => {
    setCopied(false);
    if (onClose) {
      onClose();
    } else {
      setFresh([]);
    }
  };
  const copy = () => {
    Clipboard.setString(reports.map(r => r.details).join('\n\n-----\n\n'));
    setCopied(true);
  };

  return (
    <Dialog
      testID="crash-report-notice"
      visible={visible}
      onDismiss={close}
      title={given ? t.title : t.closedUnexpectedly}
      scrollable
      actions={[
        {
          label: copied ? t.copied : t.copy,
          onPress: copy,
          testID: 'crash-report-copy',
        },
        {label: t.ok, onPress: close, mode: 'contained'},
      ]}>
      <ScrollView style={styles.list}>
        {reports.length === 0 ? (
          <Text>{t.none}</Text>
        ) : (
          reports.slice(0, 5).map(r => (
            <Text key={`${r.time}-${r.kind}`} style={styles.item}>
              <Text style={{color: theme.colors.error}}>{r.kind}</Text>
              {` · ${new Date(r.time).toLocaleString()}\n${r.summary}`}
            </Text>
          ))
        )}
        <Text style={[styles.hint, {color: theme.colors.onSurfaceVariant}]}>
          {t.hint}
        </Text>
      </ScrollView>
    </Dialog>
  );
};

/** Load the recent reports for Settings. */
export const useCrashReports = (open: boolean) => {
  const [reports, setReports] = useState<CrashReport[]>([]);
  useEffect(() => {
    if (open) {
      loadCrashReports()
        .then(setReports)
        .catch(() => setReports([]));
    }
  }, [open]);
  return reports;
};

const styles = StyleSheet.create({
  list: {maxHeight: 360},
  item: {marginBottom: 12, lineHeight: 20},
  hint: {fontSize: 12, marginTop: 4},
});
