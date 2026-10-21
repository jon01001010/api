import React, {useMemo} from 'react';
import {ScrollView, View} from 'react-native';
import {Card, Chip, Text} from 'react-native-paper';
import {registerDefaultTalents, talentRegistry} from '../services/talents';

/**
 * Read-only inventory of installed agent tools.
 * Tool permissions remain per-assistant, in Assistants > edit > Toolbox.
 * Never toggle execution globally from this diagnostic view.
 */
export const ToolboxScreen: React.FC = () => {
  const tools = useMemo(() => {
    registerDefaultTalents();
    return talentRegistry.getAll().map(engine => ({
      name: engine.name,
      description: engine.toToolDefinition().function.description,
    }));
  }, []);

  return (
    <ScrollView contentContainerStyle={{padding: 16, gap: 12}}>
      <Text variant="titleLarge">Toolbox</Text>
      <Text variant="bodyMedium">
        Installed tools available to local assistants. Enable individual tools
        in an assistant's Toolbox settings before the agent can call them.
      </Text>
      {tools.map(tool => (
        <Card key={tool.name} mode="outlined">
          <Card.Content>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8}}>
              <Text variant="titleMedium" style={{flex: 1}}>{tool.name}</Text>
              <Chip compact>Installed</Chip>
            </View>
            <Text variant="bodyMedium" style={{marginTop: 8}}>{tool.description}</Text>
            <Text variant="bodySmall" style={{marginTop: 6}}>
              Access: per-assistant opt-in. External network access may require configuration.
            </Text>
          </Card.Content>
        </Card>
      ))}
      <Text variant="bodySmall">
        Tool execution is controlled by each assistant's allowed-tool list.
        This screen does not grant Android permissions or execute tools.
      </Text>
    </ScrollView>
  );
};
