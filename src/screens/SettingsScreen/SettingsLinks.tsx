import React, {useContext} from 'react';
import {useNavigation} from '@react-navigation/native';
import {Card, List} from 'react-native-paper';

import {L10nContext} from '../../utils';
import {ROUTES} from '../../utils/navigationConstants';

/**
 * Screens that used to sit in the side menu, now reached from Settings so
 * the side menu keeps just Chat, Assistants, Models and Settings.
 */
export const SettingsLinks: React.FC<{cardStyle?: object}> = ({cardStyle}) => {
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
    },
    {
      route: ROUTES.BENCHMARK,
      title: menu.benchmark,
      description: 'Measure model speed on this phone',
      icon: 'speedometer',
    },
    {
      route: ROUTES.APP_INFO,
      title: menu.appInfo,
      description: 'Version, licences, links',
      icon: 'information-outline',
    },
  ];
  return (
    <Card elevation={0} style={cardStyle} testID="settings-links">
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
};
