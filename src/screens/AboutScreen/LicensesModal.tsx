import React, {useMemo, useState} from 'react';
import {
  FlatList,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {Button, List, Searchbar, Text} from 'react-native-paper';

import {useTheme} from '../../hooks';

/** One library, as scripts/licenses/generate.js writes it. */
export interface LicensedPackage {
  s: 'base' | 'native' | 'fonts' | 'app' | 'desktop' | 'phone-native';
  n: string;
  v: string;
  l: string;
  c: string[];
  t: string[];
  a?: string;
  u?: string;
}

interface LicenseData {
  standard: Record<string, string>;
  texts: Record<string, string>;
  packages: LicensedPackage[];
}

/** Only what this app ships: the phone and the desktop differ. */
export function shippedHere(
  packages: LicensedPackage[],
  os: string = Platform.OS,
): LicensedPackage[] {
  return packages.filter(p =>
    p.s === 'desktop'
      ? os === 'web'
      : p.s === 'phone-native'
        ? os === 'android'
        : true,
  );
}

/** Where to find a library's own source and licence. */
export function sourceLink(p: LicensedPackage): string | undefined {
  if (p.u) {
    return p.u;
  }
  if (p.s === 'app') {
    return `https://www.npmjs.com/package/${p.n}/v/${p.v}`;
  }
  if (p.s === 'desktop' || p.s === 'phone-native') {
    return `https://crates.io/crates/${p.n}/${p.v}`;
  }
  return undefined;
}

/**
 * The licence texts for one library: its own files, plus the standard text
 * of its declared licence when its own files don't already hold it.
 */
export function textsFor(data: LicenseData, p: LicensedPackage): string[] {
  const ids = [...p.t];
  const standard = data.standard[p.l];
  if (standard && !ids.includes(standard)) {
    ids.push(standard);
  }
  return ids.map(id => data.texts[id]).filter(Boolean);
}

/**
 * Settings → App Info → Open-source licences: every library the app ships
 * with, its copyright lines and licence text. Made by
 * scripts/licenses/generate.js (kept current by a test).
 */
export const LicensesModal: React.FC<{
  visible: boolean;
  onClose: () => void;
}> = ({visible, onClose}) => {
  const theme = useTheme();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<LicensedPackage | null>(null);
  // Loaded only when the list is opened (it is large).
  const data = useMemo<LicenseData | null>(
    () => (visible ? require('../../assets/licenses/third-party.json') : null),
    [visible],
  );
  const packages = useMemo(() => {
    if (!data) {
      return [];
    }
    const here = shippedHere(data.packages);
    const q = query.trim().toLowerCase();
    return q
      ? here.filter(
          p => p.n.toLowerCase().includes(q) || p.l.toLowerCase().includes(q),
        )
      : here;
  }, [data, query]);

  const surface = {backgroundColor: theme.colors.background};
  return (
    <Modal visible={visible} onRequestClose={onClose} animationType="slide">
      <View style={[styles.box, surface]} testID="licenses-modal">
        <View style={styles.header}>
          <Text variant="titleMedium" style={styles.title}>
            Open-source licences
          </Text>
          <Button onPress={open ? () => setOpen(null) : onClose}>
            {open ? 'Back' : 'Close'}
          </Button>
        </View>
        {open && data ? (
          <ScrollView contentContainerStyle={styles.detail}>
            <Text variant="titleSmall">
              {open.n} {open.v}
            </Text>
            <Text variant="bodySmall">{open.l}</Text>
            {sourceLink(open) ? (
              <Button
                compact
                onPress={() => Linking.openURL(sourceLink(open)!)}
                style={styles.link}>
                Source
              </Button>
            ) : null}
            {open.c.map(line => (
              <Text key={line} variant="bodySmall" selectable>
                {line}
              </Text>
            ))}
            {textsFor(data, open).map((text, i) => (
              <Text key={i} variant="bodySmall" selectable style={styles.text}>
                {text}
              </Text>
            ))}
          </ScrollView>
        ) : (
          <>
            <Text variant="bodySmall" style={styles.intro}>
              DesktopAgent and PocketAgent are built on PocketPal AI (MIT) and
              the libraries below. Thank you to all their authors.
            </Text>
            <Searchbar
              placeholder="Search libraries"
              value={query}
              onChangeText={setQuery}
              style={styles.search}
              testID="licenses-search"
            />
            <FlatList
              data={packages}
              keyExtractor={p => `${p.s}:${p.n}@${p.v}`}
              initialNumToRender={30}
              renderItem={({item}) => (
                <List.Item
                  title={`${item.n} ${item.v}`.trim()}
                  description={item.l}
                  onPress={() => setOpen(item)}
                  testID={`license-${item.n}`}
                />
              )}
            />
          </>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  box: {flex: 1, paddingTop: 12},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  title: {flex: 1},
  intro: {paddingHorizontal: 16, marginBottom: 8},
  search: {marginHorizontal: 16, marginBottom: 8},
  detail: {padding: 16},
  link: {alignSelf: 'flex-start', marginVertical: 4},
  text: {marginTop: 12},
});
