import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * True inside the Expo Go app. Expo Go only bundles Expo's own native modules, so the document
 * scanner and Google Sign-In are unavailable there and must be loaded lazily.
 */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Email + password sign-in against a local Supabase. Never available in release builds. */
export const devEmailLogin = __DEV__;
