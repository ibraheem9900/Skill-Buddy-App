import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';

/**
 * Auth-token storage with a web fallback.
 *
 * Native (Android/iOS) keeps using Expo SecureStore, exactly as before.
 * Expo web has no SecureStore implementation, so every API request failed in
 * its async request interceptor before the token could be read. AsyncStorage's
 * web driver uses localStorage; it is NOT encrypted, so this fallback is only
 * for local Expo-web verification and the app remains a native-first product.
 */
const isWeb = Platform.OS === 'web';

export function getSecureItem(key: string): Promise<string | null> {
  return isWeb ? AsyncStorage.getItem(key) : SecureStore.getItemAsync(key);
}

export function setSecureItem(key: string, value: string): Promise<void> {
  return isWeb ? AsyncStorage.setItem(key, value) : SecureStore.setItemAsync(key, value);
}

export function deleteSecureItem(key: string): Promise<void> {
  return isWeb ? AsyncStorage.removeItem(key) : SecureStore.deleteItemAsync(key);
}
