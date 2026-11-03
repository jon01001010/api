import AsyncStorage from '@react-native-async-storage/async-storage';
import {createCustomToolStorage} from './CustomToolStorageAdapter';

/**
 * Android persistence for approved custom-tool definitions.
 * Loading definitions does not grant any Pal permission to execute them.
 */
export const androidCustomToolStorage = createCustomToolStorage({
  getItem: key => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
});
