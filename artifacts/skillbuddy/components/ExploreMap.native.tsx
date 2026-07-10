/**
 * ExploreMap.native.tsx — real react-native-maps implementation (iOS/Android only).
 * Metro auto-selects this file on native; ExploreMap.tsx is used on web.
 */
import React, { forwardRef, useEffect } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Region } from 'react-native-maps';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';

export interface ServicePin {
  id: string;
  coordinate: { latitude: number; longitude: number };
}

export interface ExploreMapProps {
  pins: ServicePin[];
  selectedId?: string | null;
  onMarkerPress?: (id: string) => void;
  onCenterPress?: () => void;
  userLocation: { latitude: number; longitude: number };
  initialRegion: Region;
}

// ─── Pulsing user-location marker ────────────────────────────────────────────
function UserLocationMarker({ color }: { color: string }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(2, { duration: 1600, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
    opacity.value = withRepeat(
      withTiming(0, { duration: 1600, easing: Easing.out(Easing.ease) }),
      -1,
      false,
    );
  }, []);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.userWrap}>
      <Animated.View style={[styles.userRing, { backgroundColor: color }, ringStyle]} />
      <View style={[styles.userDot, { backgroundColor: color }]} />
    </View>
  );
}

// ─── Custom circular pin ──────────────────────────────────────────────────────
function PinMarker({ selected, color }: { selected: boolean; color: string }) {
  return (
    <View
      style={[
        styles.pin,
        { borderColor: color },
        selected && { width: 34, height: 34, borderRadius: 17, borderWidth: 3 },
      ]}
    >
      <View style={[styles.pinDot, { backgroundColor: color }]} />
    </View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
const ExploreMap = forwardRef<MapView, ExploreMapProps>(
  ({ pins, selectedId, onMarkerPress, onCenterPress, userLocation, initialRegion }, ref) => {
    const { colors: c } = useTheme();

    return (
      <View style={StyleSheet.absoluteFillObject}>
        <MapView
          ref={ref}
          style={StyleSheet.absoluteFillObject}
          initialRegion={initialRegion}
          showsUserLocation={false}
          showsMyLocationButton={false}
          showsCompass={false}
        >
          {pins.map((pin) => (
            <Marker
              key={pin.id}
              coordinate={pin.coordinate}
              onPress={() => onMarkerPress?.(pin.id)}
              tracksViewChanges={false}
            >
              <PinMarker selected={pin.id === selectedId} color={c.primary} />
            </Marker>
          ))}

          <Marker coordinate={userLocation} tracksViewChanges={false}>
            <UserLocationMarker color={c.primary} />
          </Marker>
        </MapView>

        {/* Center-on-location FAB */}
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: c.card }]}
          onPress={onCenterPress}
        >
          <Feather name="navigation" size={18} color={c.primary} />
        </TouchableOpacity>
      </View>
    );
  },
);

ExploreMap.displayName = 'ExploreMap';
export default ExploreMap;

const styles = StyleSheet.create({
  userWrap: { width: 24, height: 24, alignItems: 'center', justifyContent: 'center' },
  userRing: {
    position: 'absolute',
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  userDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#FFF',
  },
  pin: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFF',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 4,
    elevation: 4,
  },
  pinDot: { width: 10, height: 10, borderRadius: 5 },
  fab: {
    position: 'absolute',
    bottom: 16,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 6,
  },
});
