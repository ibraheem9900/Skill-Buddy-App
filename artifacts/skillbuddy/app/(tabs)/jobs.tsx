import React from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';

export default function JobsScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <Text style={[styles.title, { color: c.text }]}>Jobs</Text>
      </View>

      <View style={[styles.body, { paddingBottom: TAB_HEIGHT + insets.bottom + 20 }]}>
        <Animated.View entering={FadeInDown.delay(80).duration(380)} style={styles.centreWrap}>
          <View style={[styles.iconCircle, { backgroundColor: c.primaryLight }]}>
            <MaterialCommunityIcons name="briefcase-outline" size={48} color={c.primary} />
          </View>
          <Text style={[styles.heading, { color: c.text }]}>Jobs — Coming Soon</Text>
          <Text style={[styles.sub, { color: c.mutedForeground }]}>
            Post jobs, receive bids from verified experts, and manage your work orders — all in one place. Launching in Phase 2.
          </Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  centreWrap: { alignItems: 'center', gap: 16 },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  heading: { fontFamily: 'Inter_700Bold', fontSize: 22, textAlign: 'center' },
  sub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 22,
  },
});
