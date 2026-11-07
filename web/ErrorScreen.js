/**
 * Desktop app only: if the screens crash, show what happened instead of an
 * empty (black) window, with Copy details and Reload. The phone app has its
 * own crash recorder; this one is for the web build (Windows / Linux).
 */
import React from 'react';
import {Pressable, ScrollView, Text, View} from 'react-native';

const box = {
  flex: 1,
  padding: 24,
  backgroundColor: '#ffffff',
  justifyContent: 'center',
};
const button = {
  paddingVertical: 10,
  paddingHorizontal: 16,
  borderRadius: 8,
  backgroundColor: '#111111',
  marginRight: 12,
};

export function describeError(error) {
  if (!error) {
    return 'Unknown error';
  }
  const text = `${error.name || 'Error'}: ${error.message || String(error)}`;
  return error.stack ? `${text}\n\n${error.stack}` : text;
}

export function ErrorView({error, onReload}) {
  const details = describeError(error);
  return (
    <View style={box} testID="desktop-error-screen">
      <Text style={{fontSize: 20, fontWeight: '700', marginBottom: 8}}>
        DesktopAgent hit a problem
      </Text>
      <Text style={{marginBottom: 12}}>
        Your chats and settings are saved. Copy the details below to report it,
        then reload.
      </Text>
      <ScrollView
        style={{
          maxHeight: 280,
          backgroundColor: '#f2f2f2',
          padding: 12,
          marginBottom: 16,
        }}>
        <Text selectable style={{fontFamily: 'monospace', fontSize: 12}}>
          {details}
        </Text>
      </ScrollView>
      <View style={{flexDirection: 'row'}}>
        <Pressable
          style={button}
          testID="desktop-error-copy"
          onPress={() => {
            try {
              navigator.clipboard.writeText(details);
            } catch (e) {}
          }}>
          <Text style={{color: '#ffffff'}}>Copy details</Text>
        </Pressable>
        <Pressable style={button} onPress={onReload}>
          <Text style={{color: '#ffffff'}}>Reload</Text>
        </Pressable>
      </View>
    </View>
  );
}

export class ErrorScreen extends React.Component {
  constructor(props) {
    super(props);
    this.state = {error: null};
  }

  static getDerivedStateFromError(error) {
    return {error};
  }

  componentDidCatch(error) {
    console.error('[DesktopAgent] screen crashed:', error);
  }

  render() {
    if (this.state.error) {
      return (
        <ErrorView
          error={this.state.error}
          onReload={() => window.location.reload()}
        />
      );
    }
    return this.props.children;
  }
}
