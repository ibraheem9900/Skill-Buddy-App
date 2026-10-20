import React from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import SuspensionGate from '@/components/SuspensionGate';
import AnimatedTabIcon from '@/components/AnimatedTabIcon';
import TabSwipeArea from '@/components/TabSwipeArea';
import {
  HomeTabIcon,
  ServicesTabIcon,
  JobsTabIcon,
  InboxTabIcon,
  ProfileTabIcon,
} from '@/components/AnimatedTabIcons';
import { TAB_BAR_HEIGHT } from '@/lib/tabNav';

function NativeTabLayout() {
  const { t } = useLanguage();
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <NativeTabs.Trigger.Label>{t('tab_home')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="services">
        <NativeTabs.Trigger.Icon sf={{ default: 'square.grid.2x2', selected: 'square.grid.2x2.fill' }} />
        <NativeTabs.Trigger.Label>{t('tab_services')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="jobs">
        <NativeTabs.Trigger.Icon sf={{ default: 'briefcase', selected: 'briefcase.fill' }} />
        <NativeTabs.Trigger.Label>{t('tab_jobs')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="inbox">
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left', selected: 'bubble.left.fill' }} />
        <NativeTabs.Trigger.Label>{t('tab_inbox')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <NativeTabs.Trigger.Icon sf={{ default: 'person', selected: 'person.fill' }} />
        <NativeTabs.Trigger.Label>{t('tab_profile')}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const { colors: c, theme } = useTheme();
  const { t } = useLanguage();
  const insets = useSafeAreaInsets();
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const isDark = theme === 'dark';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.tabBarActive,
        tabBarInactiveTintColor: c.tabBarInactive,
        tabBarLabelStyle: { fontFamily: 'Manrope_500Medium', fontSize: 11, marginBottom: 2 },
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : c.tabBarBg,
          borderTopWidth: isWeb ? 1 : 0.5,
          borderTopColor: c.border,
          elevation: 0,
          // The bar is exactly TAB_BAR_HEIGHT of content PLUS the device's own
          // bottom inset, so gesture-nav pills and 3-button nav bars sit below
          // it instead of under the labels. Screens reserve the same padding.
          ...(isWeb
            ? { height: 84, paddingBottom: 34 }
            : {
                height: TAB_BAR_HEIGHT + insets.bottom,
                paddingTop: 8,
                paddingBottom: (insets.bottom > 0 ? insets.bottom : 0) + 6,
              }),
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={90}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: c.tabBarBg }]} />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab_home'),
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon focused={focused} color={color} activeColor={c.tabBarActive}>
              {(col) => <HomeTabIcon focused={focused} color={col} size={22} />}
            </AnimatedTabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="services"
        options={{
          title: t('tab_services'),
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon focused={focused} color={color} activeColor={c.tabBarActive}>
              {(col) => <ServicesTabIcon focused={focused} color={col} size={22} />}
            </AnimatedTabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: t('tab_jobs'),
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon focused={focused} color={color} activeColor={c.tabBarActive}>
              {(col) => <JobsTabIcon focused={focused} color={col} size={22} />}
            </AnimatedTabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: t('tab_inbox'),
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon focused={focused} color={color} activeColor={c.tabBarActive}>
              {(col) => <InboxTabIcon focused={focused} color={col} size={22} />}
            </AnimatedTabIcon>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tab_profile'),
          tabBarIcon: ({ color, focused }) => (
            <AnimatedTabIcon focused={focused} color={color} activeColor={c.tabBarActive}>
              {(col) => <ProfileTabIcon focused={focused} color={col} size={22} />}
            </AnimatedTabIcon>
          ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  return (
    <SuspensionGate>
      {/* Swipe left/right between adjacent tabs. Wraps the navigator, so it
          only ever sees gestures on the five root tab screens. */}
      <TabSwipeArea>
        {isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />}
      </TabSwipeArea>
    </SuspensionGate>
  );
}
