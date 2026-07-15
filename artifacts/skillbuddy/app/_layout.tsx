import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider } from '@/context/AuthContext';
import { BookmarkProvider } from '@/context/BookmarkContext';
import { ThemeProvider } from '@/context/ThemeContext';

SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

// Auth gate: if user somehow lands on an auth screen, push them back to tabs.
// Login/signup are disabled — the app opens directly to the dashboard.
function AuthGate() {
  const router = useRouter();
  const segments = useSegments();

  useEffect(() => {
    const inAuth = segments[0] === '(auth)';
    if (inAuth) router.replace('/(tabs)');
  }, [segments]);

  return null;
}

function RootLayoutNav() {
  return (
    <>
      <AuthGate />
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="(auth)" />
        <Stack.Screen
          name="notifications"
          options={{ headerShown: false, animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="search"
          options={{ headerShown: false, animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="categories"
          options={{ headerShown: true, title: 'Category', headerBackTitle: 'Back' }}
        />
        <Stack.Screen
          name="category/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="service/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="location"
          options={{ headerShown: false, animation: 'slide_from_right' }}
        />
        <Stack.Screen
          name="filter"
          options={{ headerShown: false, presentation: 'transparentModal', animation: 'slide_from_bottom' }}
        />
        <Stack.Screen
          name="chat/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="booking/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="quote-request"
          options={{ headerShown: false, animation: 'slide_from_bottom' }}
        />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <BookmarkProvider>
                <GestureHandlerRootView style={{ flex: 1 }}>
                  <KeyboardProvider>
                    <RootLayoutNav />
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </BookmarkProvider>
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
