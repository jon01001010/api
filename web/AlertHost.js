/**
 * Desktop app only: React Native's Alert.alert (confirmations like "Delete
 * this model?") is an empty function in react-native-web, so on the desktop
 * nothing happened. stubs/web/react-native.js sends every Alert.alert here,
 * and this shows it as a dialog with the title, message and all its buttons,
 * each doing what it does on the phone.
 */
import React, {useEffect, useState} from 'react';
import {Pressable, ScrollView, StyleSheet, Text, View} from 'react-native';

const queue = [];
let notify = null;

/** Called by Alert.alert (stubs/web/react-native.js). */
export function showDesktopAlert(title, message, buttons, options) {
  queue.push({
    title: title == null ? '' : String(title),
    message: message == null ? '' : String(message),
    buttons: buttons && buttons.length ? buttons : [{text: 'OK'}],
    cancelable: !!(options && options.cancelable),
    onDismiss: options && options.onDismiss,
  });
  if (notify) {
    notify();
  }
}

export function AlertHost() {
  const [current, setCurrent] = useState(queue[0] || null);
  useEffect(() => {
    notify = () => setCurrent(queue[0] || null);
    notify();
    return () => {
      notify = null;
    };
  }, []);
  if (!current) {
    return null;
  }
  const close = button => {
    queue.shift();
    setCurrent(queue[0] || null);
    if (button && typeof button.onPress === 'function') {
      button.onPress();
    }
  };
  return (
    <View style={styles.backdrop} testID="desktop-alert">
      <View style={styles.dialog}>
        {current.title ? (
          <Text style={styles.title}>{current.title}</Text>
        ) : null}
        {current.message ? (
          <ScrollView style={styles.messageBox}>
            <Text style={styles.message}>{current.message}</Text>
          </ScrollView>
        ) : null}
        <View style={styles.buttons}>
          {current.buttons.map((button, i) => (
            <Pressable
              key={i}
              testID={`desktop-alert-button-${i}`}
              onPress={() => close(button)}
              style={[
                styles.button,
                button.style === 'cancel' && styles.cancel,
                button.style === 'destructive' && styles.destructive,
              ]}>
              <Text
                style={[
                  styles.buttonText,
                  button.style === 'cancel' && styles.cancelText,
                ]}>
                {button.text || 'OK'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100000,
  },
  dialog: {
    width: '90%',
    maxWidth: 460,
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 20,
  },
  title: {fontSize: 18, fontWeight: '700', marginBottom: 8, color: '#111111'},
  messageBox: {maxHeight: 320, marginBottom: 8},
  message: {fontSize: 14, color: '#333333'},
  buttons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  button: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#111111',
    marginLeft: 8,
    marginTop: 6,
  },
  cancel: {backgroundColor: '#e6e6e6'},
  destructive: {backgroundColor: '#b3261e'},
  buttonText: {color: '#ffffff', fontWeight: '600'},
  cancelText: {color: '#111111'},
});
