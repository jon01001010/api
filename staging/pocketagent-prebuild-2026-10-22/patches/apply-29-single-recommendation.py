#!/usr/bin/env python3
"""Apply a single, replaceable recommendation banner to the Models screen.
Run from the PocketAgent repository root, with this checkpoint's src/ copied in.
Idempotent: refuses unexpected source shapes rather than silently mispatching.
"""
from pathlib import Path
p = Path('src/screens/ModelsScreen/ModelsScreen.tsx')
s = p.read_text()
if 'RECOMMENDED_MODEL' in s:
    print('Already applied')
    raise SystemExit(0)
needle = "import {useTheme} from '../../hooks';"
assert s.count(needle) == 1, 'ModelsScreen imports changed'
s = s.replace(needle, needle + "\nimport {RECOMMENDED_MODEL} from '../../utils/recommendedModel';")
needle = "import {FlatList, RefreshControl, Platform, Alert, View} from 'react-native';"
assert s.count(needle) == 1, 'ModelsScreen RN import changed'
s = s.replace(needle, "import {FlatList, RefreshControl, Platform, Alert, View, Linking} from 'react-native';")
needle = '      <FlatList\n        testID="flat-list"'
assert s.count(needle) == 1, 'ModelsScreen list changed'
banner = '''      <View style={{paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4}}>
        <Text variant="titleSmall">Recommended starting model: {RECOMMENDED_MODEL.displayName}</Text>
        <Text variant="bodySmall">Vision and tool calling tested on one phone. Your model variant and hardware may differ.</Text>
        <Button mode="text" onPress={() => Linking.openURL(RECOMMENDED_MODEL.officialUrl).catch(() => Alert.alert('Could not open model page'))}>
          View model information
        </Button>
      </View>
'''
s = s.replace(needle, banner + needle)
needle = "import {Portal, Snackbar} from 'react-native-paper';"
assert s.count(needle) == 1, 'Paper import changed'
s = s.replace(needle, "import {Button, Portal, Snackbar, Text} from 'react-native-paper';")
p.write_text(s)
print('Single recommendation added')
