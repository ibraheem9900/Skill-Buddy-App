/**
 * Explore screen — full-screen map with overlaid search bar and bottom card row.
 *
 * Layout:
 *   • Map fills the whole screen (absolute fill)
 *   • Search bar floats at the top (absolute, below safe-area inset)
 *   • Bottom panel is positioned above the tab bar with correct offset
 *
 * Platform strategy:
 *   • Metro automatically resolves `@/components/ExploreMap` →
 *       ExploreMap.native.tsx  on iOS / Android
 *       ExploreMap.tsx         on Web
 *   • No explicit .native import anywhere in this file → web bundler is safe.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { SERVICES } from '@/data/mockData';
import type { Service } from '@/types';
// Metro picks ExploreMap.native.tsx on device, ExploreMap.tsx on web
import ExploreMap from '@/components/ExploreMap';

// ─── Constants ────────────────────────────────────────────────────────────────
const { width: SCREEN_W } = Dimensions.get('window');
const CARD_W   = 220;
const CARD_GAP = 12;
// Tab bar is absolute-positioned; we must reserve its height explicitly
const TAB_BAR_H = Platform.OS === 'web' ? 84 : 60;

// ─── Mock coordinates around Riga, Latvia ────────────────────────────────────
const USER_LOCATION  = { latitude: 56.9496, longitude: 24.1052 };
const INITIAL_REGION = {
  latitude: 56.9496,
  longitude: 24.1052,
  latitudeDelta: 0.035,
  longitudeDelta: 0.035,
};
const SERVICE_COORDS: Record<string, { latitude: number; longitude: number }> = {
  s1: { latitude: 56.9450, longitude: 24.1100 },
  s2: { latitude: 56.9520, longitude: 24.0980 },
  s3: { latitude: 56.9560, longitude: 24.1150 },
  s4: { latitude: 56.9480, longitude: 24.1250 },
  s5: { latitude: 56.9410, longitude: 24.0950 },
  s6: { latitude: 56.9500, longitude: 24.0850 },
};

// ─── Service card ─────────────────────────────────────────────────────────────
function ExploreCard({
  service,
  selected,
  onPress,
}: {
  service: Service;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors: c } = useTheme();
  return (
    <TouchableOpacity
      style={[
        styles.card,
        {
          backgroundColor: c.card,
          borderColor: selected ? c.primary : c.border,
          borderWidth: selected ? 2 : StyleSheet.hairlineWidth,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.88}
    >
      <View style={styles.cardImgWrap}>
        <Image source={{ uri: service.image }} style={styles.cardImg} />
        <View style={styles.ratingBadge}>
          <MaterialIcons name="star" size={10} color="#FFB800" />
          <Text style={styles.ratingText}>{service.rating.toFixed(1)}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>
          {service.title}
        </Text>
        <View style={styles.cardRow}>
          <MaterialIcons name="person" size={11} color={c.mutedForeground} />
          <Text style={[styles.cardProvider, { color: c.mutedForeground }]} numberOfLines={1}>
            {service.provider.name}
          </Text>
        </View>
        <Text style={[styles.cardPrice, { color: c.primary }]}>€{service.price}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────
export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const router  = useRouter();
  const { colors: c } = useTheme();

  const [query,      setQuery]      = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef      = useRef<any>(null);
  const flatListRef = useRef<FlatList<Service>>(null);

  const filtered = SERVICES.filter(
    (s) =>
      !query ||
      s.title.toLowerCase().includes(query.toLowerCase()) ||
      s.category.toLowerCase().includes(query.toLowerCase()),
  );

  const pins = filtered.map((s) => ({
    id: s.id,
    coordinate: SERVICE_COORDS[s.id] ?? USER_LOCATION,
  }));

  // Marker tapped → scroll card list to that service
  const handleMarkerPress = useCallback(
    (id: string) => {
      setSelectedId(id);
      const idx = filtered.findIndex((s) => s.id === id);
      if (idx >= 0) {
        flatListRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
      }
    },
    [filtered],
  );

  // Card tapped → pan map to that service's pin
  const handleCardPress = useCallback((service: Service) => {
    setSelectedId(service.id);
    if (Platform.OS !== 'web') {
      const coord = SERVICE_COORDS[service.id];
      if (coord && mapRef.current) {
        mapRef.current.animateToRegion(
          { ...coord, latitudeDelta: 0.018, longitudeDelta: 0.018 },
          500,
        );
      }
    }
  }, []);

  // FAB → re-center on user location
  const handleCenter = useCallback(() => {
    if (Platform.OS !== 'web' && mapRef.current) {
      mapRef.current.animateToRegion(
        { ...USER_LOCATION, latitudeDelta: 0.035, longitudeDelta: 0.035 },
        500,
      );
    }
  }, []);

  // The bottom panel height: cards (≈175px) + panel chrome (≈60px)
  const PANEL_H = 235;

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>

      {/* ── Map — absolute fill ─────────────────────────────────────────────── */}
      <View style={StyleSheet.absoluteFillObject}>
        <ExploreMap
          ref={mapRef}
          pins={pins}
          selectedId={selectedId}
          onMarkerPress={handleMarkerPress}
          onCenterPress={handleCenter}
          userLocation={USER_LOCATION}
          initialRegion={INITIAL_REGION}
        />
      </View>

      {/* ── Search bar — floats over map below status bar ───────────────────── */}
      <Animated.View
        entering={FadeInDown.duration(350)}
        style={[styles.searchOverlay, { top: insets.top + 10 }]}
      >
        <View style={[styles.searchBar, { backgroundColor: c.card }]}>
          <Feather name="search" size={16} color={c.mutedForeground} />
          <TextInput
            style={[styles.searchInput, { color: c.text }]}
            placeholder="Search Services"
            placeholderTextColor={c.mutedForeground}
            value={query}
            onChangeText={setQuery}
            underlineColorAndroid="transparent"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')}>
              <Feather name="x-circle" size={16} color={c.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, { backgroundColor: c.primary }]}
          onPress={() => router.push('/filter')}
        >
          <Feather name="sliders" size={17} color="#FFF" />
        </TouchableOpacity>
      </Animated.View>

      {/* ── Bottom panel — positioned above the floating tab bar ───────────── */}
      <View
        style={[
          styles.bottomPanel,
          {
            backgroundColor: c.card,
            // Sit exactly on top of the absolute tab bar
            bottom: TAB_BAR_H,
          },
        ]}
      >
        <View style={[styles.panelHandle, { backgroundColor: c.border }]} />

        <View style={styles.panelHeader}>
          <Text style={[styles.panelTitle, { color: c.text }]}>
            {filtered.length} Services Nearby
          </Text>
          {selectedId && (
            <TouchableOpacity onPress={() => setSelectedId(null)}>
              <Text style={[styles.clearBtn, { color: c.primary }]}>Clear</Text>
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          ref={flatListRef}
          data={filtered}
          horizontal
          showsHorizontalScrollIndicator={false}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ paddingHorizontal: 16, gap: CARD_GAP, paddingBottom: 12 }}
          snapToInterval={CARD_W + CARD_GAP}
          decelerationRate="fast"
          getItemLayout={(_, index) => ({
            length: CARD_W + CARD_GAP,
            offset: (CARD_W + CARD_GAP) * index + 16,
            index,
          })}
          renderItem={({ item }) => (
            <ExploreCard
              service={item}
              selected={item.id === selectedId}
              onPress={() => handleCardPress(item)}
            />
          )}
          ListEmptyComponent={
            <View style={[styles.emptyWrap, { width: SCREEN_W - 32 }]}>
              <Text style={[styles.emptyText, { color: c.mutedForeground }]}>
                No services match your search
              </Text>
            </View>
          }
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // ── Search overlay
  searchOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 10,
    flexDirection: 'row',
    gap: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.14,
    shadowRadius: 8,
  },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14 },
  filterBtn: {
    width: 46,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Bottom panel
  bottomPanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 10,
    elevation: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.14,
    shadowRadius: 12,
  },
  panelHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 10,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 10,
  },
  panelTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  clearBtn:   { fontFamily: 'Inter_500Medium', fontSize: 13 },

  // ── Cards
  card: {
    width: CARD_W,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  cardImgWrap: { position: 'relative' },
  cardImg: { width: '100%', height: 105 },
  ratingBadge: {
    position: 'absolute',
    top: 7,
    left: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.52)',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  ratingText: { fontFamily: 'Inter_700Bold', fontSize: 10, color: '#FFF' },
  cardBody: { padding: 10, gap: 3 },
  cardTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  cardProvider: { fontFamily: 'Inter_400Regular', fontSize: 11, flex: 1 },
  cardPrice: { fontFamily: 'Inter_700Bold', fontSize: 14, marginTop: 2 },

  emptyWrap: { alignItems: 'center', paddingVertical: 24 },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
});
