import {StyleSheet} from 'react-native';

export const styles = StyleSheet.create({
  scrollviewContainer: {
    padding: 16,
  },
  secondaryButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  // Wraps when the buttons don't fit (narrow phones, long labels), so
  // Save is never pushed off the screen.
  actionsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    rowGap: 8,
    width: '100%',
  },
  resetWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  resetButton: {
    marginRight: 0,
  },
  resetButtonContent: {
    flexDirection: 'row-reverse',
  },
  rightButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    marginLeft: 'auto',
    gap: 8,
    alignItems: 'center',
    maxWidth: '70%',
  },
  button: {
    flex: 1,
  },
  settingsSourceContainer: {
    marginBottom: 16,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  settingsSourceTitle: {
    marginBottom: 8,
    fontWeight: '500',
  },
});
