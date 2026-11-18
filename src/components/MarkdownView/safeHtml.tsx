/**
 * What the chat's HTML renderer (react-native-render-html, used for model
 * replies and its thinking) may fetch: nothing by itself (security review
 * 2, 2026-11-18).
 *
 * A reply can hold a picture (`![x](https://site/?q=…)` or raw `<img>`).
 * The library's own picture renderer fetches it at once (Image.getSize),
 * so a model steered by a web page or a file could send what it read to
 * any site, inside the address, with no question. Here:
 * - a picture from the app's own files (`file://`) or written into the
 *   reply (`data:image/png|jpeg|gif|webp;base64`) is shown;
 * - any other picture is a placeholder ("Picture from <site>, tap to
 *   load"): only a tap that the user confirms after seeing the whole
 *   address loads it;
 * - tags that fetch or embed (video, audio, frames, objects, link, meta,
 *   base, picture/source, svg, style, script) are dropped, and inline CSS
 *   is not read at all, so raw HTML can't add a background picture or a
 *   font from elsewhere;
 * - a link opens only after the user saw its whole address and said yes.
 */
import React from 'react';
import {
  Alert,
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {showHidden} from '../../utils/shownText';

/** Tags never rendered (on top of the library's own list). */
export const IGNORED_DOM_TAGS = [
  'picture',
  'source',
  'video',
  'audio',
  'track',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'link',
  'meta',
  'base',
  'svg',
  'image',
  'style',
  'script',
  'input',
  'form',
];

/** Inline CSS is not read (no background pictures or fonts from elsewhere). */
export const CSS_INLINE = false;

const DATA_PICTURE =
  /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]+$/i;

/** A picture shown without asking: the app's own file or one in the reply. */
export function isLocalPicture(src: unknown): boolean {
  if (typeof src !== 'string') {
    return false;
  }
  const s = src.trim();
  return /^file:\/\/\//i.test(s) || DATA_PICTURE.test(s);
}

/** http(s) only: what a confirmed tap may load. */
export function isWebAddress(src: unknown): src is string {
  return typeof src === 'string' && /^https?:\/\/[^\s]+$/i.test(src.trim());
}

/** The site's name for the placeholder (never the rest of the address). */
export function siteOf(src: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(src.trim());
  if (!m) {
    return 'elsewhere';
  }
  // No user name or password part.
  const host = m[1].slice(m[1].lastIndexOf('@') + 1);
  return showHidden(host.slice(0, 80)) || 'elsewhere';
}

/** The whole address, its hidden characters shown, at most 2000 characters. */
const shownAddress = (src: string) => {
  const s = src.trim();
  return showHidden(
    s.length > 2000 ? `${s.slice(0, 2000)}… (${s.length} characters)` : s,
  );
};

/** Asks before loading a picture from elsewhere; resolves true on "Load". */
export function askToLoadPicture(src: string): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(
      'Load this picture?',
      `The reply wants to show a picture from ${siteOf(src)}. Loading it tells that site you opened it, and anything written into the address goes to it:\n\n${shownAddress(src)}`,
      [
        {text: "Don't load", style: 'cancel', onPress: () => resolve(false)},
        {text: 'Load', onPress: () => resolve(true)},
      ],
      {cancelable: true, onDismiss: () => resolve(false)},
    );
  });
}

/** Asks before opening a link from a reply, showing the whole address. */
export function askToOpenLink(href: string): void {
  if (!href) {
    return;
  }
  if ((globalThis as any).__TAURI_INTERNALS__) {
    // The desktop's own question shows the whole address and asks
    // (open_external, through Linking.openURL: stubs/web/react-native.js).
    Linking.openURL(href).catch(() => {});
    return;
  }
  Alert.alert(
    'Open this link?',
    `It opens outside PocketAgent, and anything written into the address goes to that site:\n\n${shownAddress(href)}`,
    [
      {text: "Don't open", style: 'cancel'},
      {
        text: 'Open',
        onPress: () => {
          Linking.openURL(href).catch(() => {});
        },
      },
    ],
    {cancelable: true},
  );
}

/** `renderersProps` for the chat's HTML renderer. */
export const SAFE_RENDERERS_PROPS = {
  a: {
    onPress: (_event: unknown, href: string) => askToOpenLink(href),
  },
};

export function SafePicture({
  src,
  alt,
  maxWidth,
}: {
  src?: string;
  alt?: string;
  maxWidth?: number;
}): React.JSX.Element {
  const [allowed, setAllowed] = React.useState(false);
  const label = (alt ?? '').trim();
  const width = Math.min(maxWidth ?? 280, 280);
  if (src && isLocalPicture(src)) {
    return (
      <Image
        testID="markdown-picture"
        source={{uri: src.trim()}}
        accessibilityLabel={label || undefined}
        style={[styles.picture, {width}]}
        resizeMode="contain"
      />
    );
  }
  if (allowed && isWebAddress(src)) {
    return (
      <Image
        testID="markdown-picture"
        source={{uri: src.trim()}}
        accessibilityLabel={label || undefined}
        style={[styles.picture, {width}]}
        resizeMode="contain"
      />
    );
  }
  const web = isWebAddress(src);
  return (
    <Pressable
      testID="markdown-picture-placeholder"
      disabled={!web}
      accessibilityRole={web ? 'button' : undefined}
      onPress={() => {
        if (web) {
          askToLoadPicture(src as string).then(yes => yes && setAllowed(true));
        }
      }}
      style={styles.placeholder}>
      <Text style={styles.placeholderText}>
        {label ? `${showHidden(label.slice(0, 200))} · ` : ''}
        {web ? `Picture from ${siteOf(src)}, tap to load` : 'Picture not shown'}
      </Text>
    </Pressable>
  );
}

/** The `img` renderer: never fetches by itself (see above). */
export function SafeImgRenderer(props: any): React.JSX.Element {
  const attrs = props?.tnode?.attributes ?? {};
  return (
    <View>
      <SafePicture src={attrs.src} alt={attrs.alt} />
    </View>
  );
}

const styles = StyleSheet.create({
  picture: {height: 200, marginVertical: 4},
  placeholder: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#888888',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginVertical: 4,
    alignSelf: 'flex-start',
  },
  placeholderText: {fontSize: 13, color: '#888888'},
});
