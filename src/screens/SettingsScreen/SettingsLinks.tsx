import React, {useContext} from 'react';
import {Linking, Platform} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import {Card, List} from 'react-native-paper';
import {observer} from 'mobx-react';

import {L10nContext} from '../../utils';
import {ROUTES} from '../../utils/navigationConstants';
import {uiStore} from '../../store';

/**
 * Screens that used to sit in the side menu, now reached from Settings so
 * the side menu keeps just Chat, Assistants, Models and Settings.
 */
export const SettingsLinks: React.FC<{cardStyle?: object}> = observer(
  ({cardStyle}) => {
    const navigation = useNavigation<any>();
    const l10n = useContext(L10nContext);
    const menu = l10n.components.sidebarContent.menuItems;
    const links = [
      {
        route: ROUTES.TOOLBOX,
        title: 'Toolbox',
        description: 'Tools, memory, system prompt, agent limits',
        icon: 'toolbox-outline',
      },
      {
        route: ROUTES.POCKETAGENT_HARDWARE,
        title: 'PocketAgent Hardware',
        description: 'Backends (CPU / GPU / NPU) and processor choice',
        icon: 'chip',
        dev: true,
      },
      {
        route: ROUTES.BENCHMARK,
        title: menu.benchmark,
        description: 'Measure model speed on this phone',
        icon: 'speedometer',
        dev: true,
      },
      {
        route: ROUTES.APP_INFO,
        title: menu.appInfo,
        description: 'Version, licences, links',
        icon: 'information-outline',
      },
    ].filter(link => !link.dev || uiStore.showDevSettings);
    // Android's own page for choosing the assistant (PocketAgent is listed
    // there); the app can't pick itself.
    const openAssistantSettings = () =>
      Linking.sendIntent('android.settings.MANAGE_DEFAULT_APPS_SETTINGS').catch(
        () =>
          Linking.sendIntent('android.settings.VOICE_INPUT_SETTINGS').catch(
            () => Linking.openSettings(),
          ),
      );
    return (
      <Card elevation={0} style={cardStyle} testID="settings-links">
        {Platform.OS === 'android' && (
          <List.Item
            testID="settings-link-assistant"
            title="Use as your phone's assistant"
            description="Pick PocketAgent under Digital assistant app; then long-press power opens it listening"
            left={props => <List.Icon {...props} icon="microphone-message" />}
            right={props => <List.Icon {...props} icon="open-in-new" />}
            onPress={openAssistantSettings}
          />
        )}
        {links.map(link => (
          <List.Item
            key={link.route}
            testID={`settings-link-${link.route}`}
            title={link.title}
            description={link.description}
            left={props => <List.Icon {...props} icon={link.icon} />}
            right={props => <List.Icon {...props} icon="chevron-right" />}
            onPress={() => navigation.navigate(link.route)}
          />
        ))}
      </Card>
    );
  },
);
