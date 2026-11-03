import {StyleSheet} from 'react-native';

import {
  type PhosphorAware,
  themeColor,
  themeFont,
  themeRadius,
} from '../../theme/phosphor';

// Plain object (not via StyleSheet.create) because react-syntax-highlighter's
// customStyle is merged with Object.assign — a numeric StyleSheet id won't
// flatten the upstream white PreTag fallback. See MarkdownView for the why.
export const codeHighlighterPreOverride = {
  backgroundColor: 'transparent',
} as const;

export const createStyles = (
  colors: {
    background: string;
    border: string;
    text: string;
    headerBg: string;
    modalOverlay: string;
  },
  theme?: PhosphorAware,
) =>
  StyleSheet.create({
    container: {
      // alignSelf: 'stretch' makes the bubble fill the cross-axis of its
      // parent (horizontal width in the default column-flex chat row).
      // Without it, the auto-width parent + percentage-width WebView
      // (`collapsedWebView: { width: '100%' }`) hits the classic flexbox
      // "0% of nothing" race: on first layout pass the container shrink-
      // wraps to intrinsic content, the WebView's 100% resolves to that
      // small value, and only a later layout pass (e.g., when the model
      // emits a follow-up text bubble below) gives container a definite
      // width that lets WebView re-measure.
      alignSelf: 'stretch',
      marginVertical: 8,
      marginHorizontal: 12,
      borderRadius: themeRadius(theme, 12),
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.background,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.headerBg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 12,
      fontWeight: '600',
      color: colors.text,
      flex: 1,
    },
    headerButton: {
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    collapsedWebView: {
      height: 250,
      width: '100%',
      backgroundColor: colors.background,
    },
    codeSurface: {
      backgroundColor: themeColor(theme, '#282c34'),
    },
    codeInnerScroll: {
      backgroundColor: themeColor(theme, '#282c34'),
    },
    codeContent: {
      padding: 12,
      minWidth: '100%',
      flexGrow: 1,
    },
    codeText: {
      fontFamily: themeFont(theme, 'Menlo'),
      fontSize: 11,
      lineHeight: 16,
      // Default color for any token the highlighter doesn't colorize;
      // atomOneDark lays its own per-token colors on top.
      color: themeColor(theme, '#abb2bf'),
    },
    modalRoot: {
      flex: 1,
      backgroundColor: colors.modalOverlay,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 12,
      backgroundColor: colors.headerBg,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    modalTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
      flex: 1,
    },
    closeButton: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
      paddingHorizontal: 8,
      paddingVertical: 4,
    },
    modalHeaderButton: {
      marginRight: 8,
    },
    modalWebView: {
      flex: 1,
      backgroundColor: colors.background,
    },
    errorPanel: {
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
      gap: 12,
    },
    errorText: {
      color: colors.text,
      fontSize: 14,
      textAlign: 'center',
    },
    errorButton: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: themeRadius(theme, 8),
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    errorButtonText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    remoteNote: {
      color: colors.text,
      opacity: 0.7,
      fontSize: 12,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
  });
