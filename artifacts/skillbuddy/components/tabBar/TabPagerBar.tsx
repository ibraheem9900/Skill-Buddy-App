import React, { useEffect } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/context/ThemeContext';
import {
  HomeTabIcon,
  ServicesTabIcon,
  JobsTabIcon,
  InboxTabIcon,
  ProfileTabIcon,
  type TabIconProps,
} from '@/components/AnimatedTabIcons';
import { TAB_BAR_HEIGHT } from '@/lib/tabNav';
import {
  TAB_ICON_LIFT_PX,
  iconFillRange,
  iconLiftRange,
  iconScaleRange,
  pillLeftRange,
} from '@/lib/tabPager';
import useReduceMotion from '@/components/tabBar/useReduceMotion';

const ICONS: Record<string, React.ComponentType<TabIconProps>> = {
  index: HomeTabIcon,
  services: ServicesTabIcon,
  jobs: JobsTabIcon,
  inbox: InboxTabIcon,
  profile: ProfileTabIcon,
};

interface Route {
  key: string;
  name: string;
}

/** The props tab-view hands to `renderTabBar` (via expo-router's wrapper). */
export interface TabPagerBarProps {
  /**
   * The tab the navigator has settled on. Reported once per tab change so the
   * pages can tell which way a drag is going; it is deliberately NOT derived
   * from the URL, which lags the navigator by a frame or two after a swipe.
   */
  onActiveIndexChange?: (index: number) => void;
  state: { index: number; routes: Route[] };
  descriptors: Record<string, { options?: { title?: string } }>;
  /** Continuous pager offset in tab units, e.g. 2.35 between Jobs and Inbox. */
  position: Animated.AnimatedInterpolation<number>;
  layout: { width: number; height: number };
  jumpTo: (key: string) => void;
}

/**
 * One continuous position drives the whole bar:
 *   • the active pill slides from one tab's centre to the next;
 *   • each icon cross-fades its outline copy into its filled copy;
 *   • each label cross-fades inactive → active colour;
 *   • the incoming icon lifts (1 → 1.1) as its tab becomes active.
 *
 * All of it runs as Animated interpolations of the pager's native value, so a
 * drag costs zero React renders and zero JS frames. Tapping a tab animates the
 * pager, which feeds the very same value — tap and swipe are the same motion.
 */
export default function TabPagerBar({
  state,
  descriptors,
  position,
  layout,
  jumpTo,
  onActiveIndexChange,
}: TabPagerBarProps) {
  const { colors: c, theme } = useTheme();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();

  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const isDark = theme === 'dark';

  // Once per tab change, never per frame: the pages need the settled index for
  // the direction of their parallax.
  useEffect(() => {
    onActiveIndexChange?.(state.index);
  }, [state.index, onActiveIndexChange]);

  const routes = state.routes;
  const count = routes.length;
  const width = layout.width;

  const pillLeft = position.interpolate(pillLeftRange(count, width));

  return (
    <View
      style={[
        styles.bar,
        {
          height: isWeb ? 84 : TAB_BAR_HEIGHT + insets.bottom,
          paddingTop: isWeb ? 6 : 8,
          paddingBottom: isWeb ? 34 : (insets.bottom > 0 ? insets.bottom : 0) + 6,
          backgroundColor: isIOS ? 'transparent' : c.tabBarBg,
          borderTopColor: c.border,
          borderTopWidth: isWeb ? 1 : 0.5,
        },
      ]}
    >
      {isIOS ? (
        <BlurView
          intensity={90}
          tint={isDark ? 'dark' : 'light'}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      <View style={styles.row}>
        {/* The single active pill — it slides with the swipe, never fades. */}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.pill,
            {
              backgroundColor: `${c.tabBarActive}1A`,
              transform: [{ translateX: pillLeft }],
            },
          ]}
        />

        {routes.map((route, index) => {
          const title =
            descriptors[route.key]?.options?.title ?? route.name;
          const selected = state.index === index;
          const Icon = ICONS[route.name] ?? HomeTabIcon;

          const fill = position.interpolate(iconFillRange(index));
          const scale = reduceMotion
            ? 1
            : position.interpolate(iconScaleRange(index));
          const lift = reduceMotion
            ? 0
            : position.interpolate(iconLiftRange(index));

          return (
            <Pressable
              key={route.key}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={title}
              testID={`tab-${route.name}`}
              onPress={() => jumpTo(route.key)}
              style={styles.item}
            >
              <Animated.View
                style={[
                  styles.iconBox,
                  {
                    transform: reduceMotion
                      ? [{ scale: 1 }]
                      : [
                          { scale },
                          {
                            translateY: Animated.multiply(
                              lift as Animated.AnimatedInterpolation<number>,
                              -TAB_ICON_LIFT_PX
                            ),
                          },
                        ],
                  },
                ]}
              >
                <View style={styles.iconLayers}>
                  <Icon color={c.tabBarInactive} fill={0} size={22} />
                  <Animated.View
                    pointerEvents="none"
                    style={[StyleSheet.absoluteFill, { opacity: fill }]}
                  >
                    <Icon color={c.tabBarActive} fill={1} size={22} />
                  </Animated.View>
                </View>
              </Animated.View>

              <View style={styles.labelBox}>
                <Text
                  numberOfLines={1}
                  style={[styles.label, { color: c.tabBarInactive }]}
                >
                  {title}
                </Text>
                <Animated.Text
                  numberOfLines={1}
                  style={[
                    styles.label,
                    styles.labelOverlay,
                    { color: c.tabBarActive, opacity: fill },
                  ]}
                >
                  {title}
                </Animated.Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  pill: {
    position: 'absolute',
    top: 1,
    left: 0,
    height: 28,
    width: 44,
    borderRadius: 14,
  },
  item: {
    flex: 1,
    alignItems: 'center',
  },
  iconBox: {
    width: 44,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconLayers: {
    width: 22,
    height: 22,
  },
  labelBox: {
    height: 14,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  label: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 11,
  },
  labelOverlay: {
    position: 'absolute',
  },
});
