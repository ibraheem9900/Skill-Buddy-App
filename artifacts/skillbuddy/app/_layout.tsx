import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  useFonts,
} from '@expo-google-fonts/manrope';
import { Stack, useRouter, useSegments } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { RealtimeProvider } from '@/context/RealtimeContext';
import { BookmarkProvider } from '@/context/BookmarkContext';
import { ThemeProvider, useTheme } from '@/context/ThemeContext';
import { RoleProvider } from '@/context/RoleContext';
import { FilterProvider } from '@/context/FilterContext';
import { AlertModalProvider } from '@/context/AlertModalContext';
import { BidResultsProvider, useBidResults } from '@/context/BidResultsContext';
import { MoneyEventsProvider } from '@/context/MoneyEventsContext';
import BidResultBanner from '@/components/BidResultBanner';
import MoneyEventBanner from '@/components/MoneyEventBanner';
import NavigationLoaderOverlay from '@/components/NavigationLoaderOverlay';
import { LanguageProvider, useLanguage } from '@/context/LanguageContext';

SplashScreen.preventAutoHideAsync();
const queryClient = new QueryClient();

// Route gate: directs users to onboarding, auth, or main app.
// The initial route is (auth), so all users start in the auth stack.
// - Brand new user (no onboarding seen) → stays on (auth)/onboarding
// - Authenticated user on any (auth) screen → redirect to (tabs)
// - Unauthenticated user who completed onboarding → redirect to (auth)/login
function RouteGate() {
  const router = useRouter();
  const segments = useSegments();
  const { isAuthenticated, isLoading, hasSeenOnboarding } = useAuth();

  useEffect(() => {
    if (isLoading) return; // wait for auth state to resolve

    const inAuth = segments[0] === '(auth)';
    const inTabs = segments[0] === '(tabs)';
    // The specific screen inside (auth), e.g. 'choice', 'login', 'signup', etc.
    const authScreen = inAuth ? segments[1] : null;

    // Screens where an already-onboarded, unauthenticated user is "stuck"
    // and should be redirected to the choice screen.
    const onboardingScreens = ['onboarding', 'about', 'privacy', 'language-select'];
    const isStuckInOnboarding = authScreen != null && onboardingScreens.includes(authScreen);

    if (isAuthenticated && inAuth) {
      // Already logged in, on an auth screen → go to main app
      router.replace('/(tabs)');
    } else if (!isAuthenticated && hasSeenOnboarding && isStuckInOnboarding) {
      // Completed onboarding before but not logged in and still on an onboarding screen
      // → send them to the choice screen.  Do NOT fire when they're already on
      // choice/login/signup/forgot-password/verify-email — those are intentional.
      router.replace('/(auth)/choice');
    } else if (!isAuthenticated && !hasSeenOnboarding && inTabs) {
      // Somehow on tabs without auth or onboarding → back to onboarding
      router.replace('/(auth)/onboarding');
    } else if (isAuthenticated && inTabs) {
      // Authenticated user on tabs → perfect, no redirect needed
    }
  }, [isAuthenticated, isLoading, hasSeenOnboarding, segments]);

  return null;
}

/** One bid-result banner is about 104 px tall; the money banner is stacked
 *  under it rather than on top of it when both are on screen at once. */
const BID_BANNER_STACK_OFFSET = 104;

function RootLayoutNav() {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const { banner: bidBanner } = useBidResults();
  return (
    <>
      <RouteGate />
      <Stack
        initialRouteName="(auth)"
        screenOptions={{
          headerShown: false,
          animation: 'slide_from_right',
          contentStyle: { backgroundColor: c.background },
        }}
      >
        <Stack.Screen name="(auth)" />
        <Stack.Screen name="(tabs)" />
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
          options={{ headerShown: true, title: t('search_category_label'), headerBackTitle: t('action_back') }}
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
          options={{
            headerShown: false,
            presentation: 'transparentModal',
            animation: 'slide_from_bottom',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen
          name="chat/[id]"
          options={{ headerShown: false }}
        />
        <Stack.Screen
          name="quote-request"
          options={{ headerShown: false, animation: 'slide_from_bottom' }}
        />
      </Stack>
      <NavigationLoaderOverlay />
      {/* The provider's live bid result, above every screen. Mounted here so it
          survives navigation; it renders nothing unless a result is announced. */}
      <BidResultBanner />
      {/* Money events (payment/invoice/escrow/wallet), same corner: lifted below
          the bid-result banner when that one is showing. */}
      <MoneyEventBanner topOffset={bidBanner ? BID_BANNER_STACK_OFFSET : 0} />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
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
              {/* Realtime lives inside AuthProvider: it starts on login and
                  stops on logout / account switch. Renders nothing. */}
              <RealtimeProvider>
              <RoleProvider>
              <FilterProvider>
              <AlertModalProvider>
              <LanguageProvider>
              {/* One global handler for the provider's bid.accepted / bid.rejected.
                  Inside LanguageProvider (the banner is translated) and inside
                  RoleProvider (only provider mode acts). Renders nothing. */}
              <BidResultsProvider>
              {/* The money side of the realtime layer (payment.*, invoice.*,
                  escrow.*, wallet.credit_earned): one handler for the app, so it
                  sits beside the bid-result handler. Renders nothing itself. */}
              <MoneyEventsProvider>
              <BookmarkProvider>
                <GestureHandlerRootView style={{ flex: 1 }}>
                  <KeyboardProvider>
                    <RootLayoutNav />
                  </KeyboardProvider>
                </GestureHandlerRootView>
              </BookmarkProvider>
              </MoneyEventsProvider>
              </BidResultsProvider>
              </LanguageProvider>
              </AlertModalProvider>
              </FilterProvider>
              </RoleProvider>
              </RealtimeProvider>
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
