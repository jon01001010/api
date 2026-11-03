import React, {useMemo} from 'react';

import {marked} from 'marked';
import RenderHtml, {defaultSystemFonts} from 'react-native-render-html';

import {useTheme} from '../../hooks';
import {ThinkingBubble} from '../ThinkingBubble';

import {createTagsStyles} from '../MarkdownView/styles';
import {PHOSPHOR_FONT} from '../../theme/phosphor';
import {
  tableRenderers,
  tableHTMLElementModels,
} from '../MarkdownView/TableRenderers';

interface ReasoningBlockProps {
  text: string;
  maxWidth: number;
  /**
   * When true, the inner ThinkingBubble auto-collapses to its compact
   * text-only row. The user's manual toggle still wins for the bubble's
   * lifetime — see ThinkingBubble's `userToggledRef`.
   */
  autoCollapse?: boolean;
}

const isEmpty = (s: string) => !s || s.trim() === '';

export const ReasoningBlock: React.FC<ReasoningBlockProps> = React.memo(
  ({text, maxWidth, autoCollapse}) => {
    const theme = useTheme();

    const tagsStyles = useMemo(() => createTagsStyles(theme), [theme]);

    // Reasoning uses the same base markdown styling as content but
    // overrides body color/size to match the thinking-bubble palette.
    const reasoningTagsStyles = useMemo(
      () => ({
        ...tagsStyles,
        body: {
          ...tagsStyles.body,
          color: theme.colors.thinkingBubbleText,
          fontSize: 14,
          lineHeight: 20,
        },
      }),
      [tagsStyles, theme],
    );

    const renderers = useMemo(() => ({...tableRenderers}), []);

    const defaultTextProps = useMemo(
      () => ({selectable: false, userSelect: 'none' as const}),
      [],
    );

    // Register the bundled mono cuts, as the chat renderer does, so the
    // Phosphor style's font isn't dropped (unknown families are ignored).
    const systemFonts = useMemo(
      () => [
        ...defaultSystemFonts,
        PHOSPHOR_FONT.regular,
        PHOSPHOR_FONT.medium,
      ],
      [],
    );

    const htmlContent = useMemo(() => marked(text) as string, [text]);
    const source = useMemo(() => ({html: htmlContent}), [htmlContent]);

    if (isEmpty(text)) {
      return null;
    }

    return (
      <ThinkingBubble autoCollapse={autoCollapse}>
        <RenderHtml
          contentWidth={maxWidth}
          source={source}
          tagsStyles={reasoningTagsStyles}
          defaultTextProps={defaultTextProps}
          systemFonts={systemFonts}
          renderers={renderers}
          customHTMLElementModels={tableHTMLElementModels}
        />
      </ThinkingBubble>
    );
  },
  (prev, next) =>
    prev.text === next.text &&
    prev.maxWidth === next.maxWidth &&
    prev.autoCollapse === next.autoCollapse,
);
