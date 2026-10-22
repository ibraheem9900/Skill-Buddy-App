import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { NativeTabs } from 'expo-router/unstable-native-tabs';
import TopTabs from 'expo-router/js-top-tabs';
import type { MaterialTopTabBarProps } from 'expo-router/js-top-tabs';
import * as Haptics from 'expo-haptics';
import { usePathname } from 'expo-router';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import SuspensionGate from '@/components/SuspensionGate';
import TabPagerBar, { type TabPagerBarProps } from '@/components/tabBar/TabPagerBar';
import { TabPagerIndexContext } from '@/components/tabBar/TabPagerContext';
import { tabIndex } from '@/lib/tabNav';

/** A light tick when a swipe (or tap) lands on a different tab. */
const TAB_HAPTICS_ENABLED = true;

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

/**
 * The five tab screens as a horizontal pager.
 *
 * expo-router's TopTabs (react-native-tab-view over react-native-pager-view)
 * renders the five scenes side by side and reports a continuous `position`
 * (0…4, including the fraction under the finger) from the native scroll. The
 * custom bar reads that same value, so the pill, the icon fills and the labels
 * are always exactly where the pages are.
 *
 * `lazyPreloadDistance: 1` keeps the immediate neighbours mounted without
 * mounting the whole app at launch, so a reveal is never blank.
 */
function ClassicTabLayout() {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const pathname = usePathname();
  // Seeded from the URL (deep links land on the right tab) and kept up to date
  // by the bar, which sees the navigator's own index the moment it settles.
  const [activeIndex, setActiveIndex] = useState(() => Math.max(0, tabIndex(pathname)));

  return (
    <TabPagerIndexContext.Provider value={activeIndex}>
      <TopTabs
        tabBarPosition="bottom"
        overScrollMode="always"
        tabBar={(props: MaterialTopTabBarProps) => (
          <TabPagerBar
            {...(props as unknown as TabPagerBarProps)}
            onActiveIndexChange={setActiveIndex}
          />
        )}
        screenOptions={{
          swipeEnabled: true,
          animationEnabled: true,
          lazy: true,
          lazyPreloadDistance: 1,
          sceneStyle: { backgroundColor: c.background },
        }}
      >
        <TopTabs.Screen name="index" options={{ title: t('tab_home') }} />
        <TopTabs.Screen name="services" options={{ title: t('tab_services') }} />
        <TopTabs.Screen name="jobs" options={{ title: t('tab_jobs') }} />
        <TopTabs.Screen name="inbox" options={{ title: t('tab_inbox') }} />
        <TopTabs.Screen name="profile" options={{ title: t('tab_profile') }} />
      </TopTabs>
    </TabPagerIndexContext.Provider>
  );
}

/**
 * One light impact per tab change, whether it came from a tap or a swipe.
 * Deliberately outside the bar so it fires exactly once when navigation lands.
 */
function TabHaptics() {
  const pathname = usePathname();
  const index = tabIndex(pathname);
  const previous = useRef(index);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      previous.current = index;
      return;
    }
    if (index < 0 || index === previous.current) return;
    previous.current = index;
    if (!TAB_HAPTICS_ENABLED) return;
    if (Platform.OS === 'android' || Platform.OS === 'ios') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {
        /* haptics are cosmetic — never let them surface an error */
      });
    }
  }, [index]);

  return null;
}

export default function TabLayout() {
  return (
    <SuspensionGate>
      <TabHaptics />
      {isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />}
    </SuspensionGate>
  );
}
