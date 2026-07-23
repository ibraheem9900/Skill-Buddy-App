/**
 * ExploreMap.tsx — web fallback.
 * Metro auto-selects ExploreMap.native.tsx on iOS/Android; this file is used on web.
 * Must export the same interface so TypeScript stays happy in shared code.
 */
import React, { forwardRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';

export interface ServicePin {
  id: string;
  coordinate: { latitude: number; longitude: number };
}

export interface ExploreMapProps {
  pins?: ServicePin[];
  selectedId?: string | null;
  onMarkerPress?: (id: string) => void;
  onCenterPress?: () => void;
  userLocation?: { latitude: number; longitude: number };
  initialRegion?: object;
}

// forwardRef so the parent can pass mapRef without TS errors on web
const ExploreMap = forwardRef<unknown, ExploreMapProps>((_props, _ref) => {
  const { colors: c } = useTheme();
  return (
    <View style={[styles.root, { backgroundColor: c.primaryLight }]}>
      <View style={[styles.iconWrap, { backgroundColor: c.accent }]}>
        <Feather name="map" size={40} color={c.primary} />
      </View>
      <Text style={[styles.label, { color: c.text }]}>Map available on device</Text>
      <Text style={[styles.sub, { color: c.mutedForeground }]}>
        Open in Expo Go on iOS/Android to see the live map
      </Text>
    </View>
  );
});

ExploreMap.displayName = 'ExploreMap';
export default ExploreMap;

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  sub: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 40,
  },
});
