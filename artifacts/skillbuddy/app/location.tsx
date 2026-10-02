import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import useCountries from '@/hooks/useCountries';
import { setSelectedLocation } from '@/hooks/useSelectedLocation';
import { authApi } from '@/services/api';
import type { AddressRegionResponse } from '@/types';

type Level = 'country' | 'county' | 'city';

/**
 * Location picker.
 *
 * There is no location endpoint that returns a flat list of cities, so this
 * screen walks the REAL public geo cascade the address screens already use —
 * GET /countries (shared session cache) → GET /countries/{id}/counties →
 * GET /counties/{id}/cities. The previous hardcoded SUGGESTIONS fixture
 * (seven invented cities) is gone; every row here comes from the server.
 * Picking a city records it in the session location store so the home header
 * reflects the choice.
 */
export default function LocationScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const { status: countriesStatus, countries, load: loadCountries, refresh: refreshCountries } = useCountries();

  const [level, setLevel] = useState<Level>('country');
  const [query, setQuery] = useState('');

  const [countryId, setCountryId] = useState<number | null>(null);
  const [countryName, setCountryName] = useState<string | null>(null);

  const [counties, setCounties] = useState<AddressRegionResponse[] | null>(null);
  const [countiesLoading, setCountiesLoading] = useState(false);
  const [countiesError, setCountiesError] = useState(false);

  const [countyId, setCountyId] = useState<number | null>(null);
  const [countyName, setCountyName] = useState<string | null>(null);

  const [cities, setCities] = useState<AddressRegionResponse[] | null>(null);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [citiesError, setCitiesError] = useState(false);

  useEffect(() => {
    void loadCountries();
  }, [loadCountries]);

  const loadCounties = (id: number) => {
    setCountiesLoading(true);
    setCountiesError(false);
    authApi
      .getCounties(id)
      .then(({ data }) => setCounties(Array.isArray(data) ? data : []))
      .catch(() => setCountiesError(true))
      .finally(() => setCountiesLoading(false));
  };

  const loadCities = (id: number) => {
    setCitiesLoading(true);
    setCitiesError(false);
    authApi
      .getCities(id)
      .then(({ data }) => setCities(Array.isArray(data) ? data : []))
      .catch(() => setCitiesError(true))
      .finally(() => setCitiesLoading(false));
  };

  const pickCountry = (id: number, name: string) => {
    setCountryId(id);
    setCountryName(name);
    setCountyId(null);
    setCountyName(null);
    setCounties(null);
    setCities(null);
    setQuery('');
    setLevel('county');
    loadCounties(id);
  };

  const pickCounty = (id: number, name: string) => {
    setCountyId(id);
    setCountyName(name);
    setCities(null);
    setQuery('');
    setLevel('city');
    loadCities(id);
  };

  const pickCity = (id: number, name: string) => {
    if (countryId == null || !countryName) return; // cannot happen — guarded by level
    setSelectedLocation({
      countryId,
      countryName,
      countyId,
      countyName,
      cityId: id,
      cityName: name,
    });
    router.back();
  };

  /** Header back: step up the cascade before leaving the screen. */
  const goUp = () => {
    if (level === 'city') {
      setLevel('county');
      setCities(null);
      setQuery('');
    } else if (level === 'county') {
      setLevel('country');
      setCounties(null);
      setQuery('');
    } else {
      router.back();
    }
  };

  const source: AddressRegionResponse[] | null =
    level === 'country' ? countries : level === 'county' ? counties : cities;
  const loadingNow =
    level === 'country' ? countriesStatus === 'loading' : level === 'county' ? countiesLoading : citiesLoading;
  const errorNow =
    level === 'country' ? countriesStatus === 'error' : level === 'county' ? countiesError : citiesError;
  const titleKey = level === 'country' ? 'addr_c_country' : level === 'county' ? 'addr_c_county' : 'addr_c_city';

  const retry = () => {
    if (level === 'country') void refreshCountries();
    else if (level === 'county') countryId != null && loadCounties(countryId);
    else countyId != null && loadCities(countyId);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (source ?? []).filter((item) => !q || item.name.toLowerCase().includes(q));
  }, [source, query]);

  const onPick = (item: AddressRegionResponse) => {
    if (level === 'country') pickCountry(item.id, item.name);
    else if (level === 'county') pickCounty(item.id, item.name);
    else pickCity(item.id, item.name);
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <View style={{ height: insets.top, backgroundColor: c.background }} />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={goUp} style={[styles.backBtn, { backgroundColor: c.muted }]}>
          <Feather name="arrow-left" size={20} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
          {t(titleKey)}
        </Text>
      </View>

      {/* ── Breadcrumb ─────────────────────────────────────────────────────── */}
      {(countryName || countyName) && (
        <View style={styles.crumbs}>
          <TouchableOpacity
            onPress={() => {
              setLevel('country');
              setCounties(null);
              setQuery('');
            }}
          >
            <Text style={[styles.crumb, { color: c.primary }]} numberOfLines={1}>
              {countryName}
            </Text>
          </TouchableOpacity>
          {countyName && level === 'city' && (
            <>
              <Feather name="chevron-right" size={14} color={c.mutedForeground} />
              <TouchableOpacity
                onPress={() => {
                  setLevel('county');
                  setCities(null);
                  setQuery('');
                }}
              >
                <Text style={[styles.crumb, { color: c.primary }]} numberOfLines={1}>
                  {countyName}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* ── Search bar ─────────────────────────────────────────────────────── */}
      <View style={[styles.searchRow, { backgroundColor: c.muted }]}>
        <Feather name="search" size={18} color={c.mutedForeground} style={styles.searchIcon} />
        <TextInput
          style={[styles.input, { color: c.text }]}
          placeholder={t('location_search')}
          placeholderTextColor={c.mutedForeground}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          returnKeyType="search"
          underlineColorAndroid="transparent"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} style={styles.clearBtn}>
            <Feather name="x-circle" size={18} color={c.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Use current location ───────────────────────────────────────────── */}
      <TouchableOpacity style={styles.currentRow} onPress={() => router.back()} activeOpacity={0.7}>
        <View style={[styles.currentIcon, { backgroundColor: c.primaryLight }]}>
          <MaterialIcons name="my-location" size={18} color={c.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.currentLabel, { color: c.text }]}>{t('location_current')}</Text>
          <Text style={[styles.currentSub, { color: c.mutedForeground }]}>{t('location_detect')}</Text>
        </View>
        <Feather name="chevron-right" size={18} color={c.mutedForeground} />
      </TouchableOpacity>

      <View style={[styles.divider, { backgroundColor: c.border }]} />

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {loadingNow ? (
        <View style={styles.state}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : errorNow ? (
        <View style={styles.state}>
          <Feather name="wifi-off" size={28} color={c.destructive} />
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('addr_c_err_geo')}</Text>
          <TouchableOpacity onPress={retry}>
            <Text style={[styles.retry, { color: c.primary }]}>{t('addr_retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
          ListEmptyComponent={
            <View style={styles.state}>
              <Feather name="map-pin" size={32} color={c.border} />
              <Text style={[styles.stateText, { color: c.mutedForeground }]}>
                {source && source.length === 0 ? t('addr_c_geo_empty') : t('geo_no_match')}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.resultRow} onPress={() => onPick(item)} activeOpacity={0.7}>
              <View style={[styles.resultIcon, { backgroundColor: c.muted }]}>
                <MaterialIcons name={level === 'city' ? 'place' : 'public'} size={18} color={c.mutedForeground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.resultName, { color: c.text }]}>{item.name}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={c.mutedForeground} />
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.border }]} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 18,
    flex: 1,
  },

  crumbs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  crumb: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 4,
    borderRadius: 14,
    overflow: 'hidden',
  },
  searchIcon: { marginLeft: 14 },
  input: {
    flex: 1,
    paddingVertical: 13,
    paddingHorizontal: 8,
    fontFamily: 'Manrope_400Regular',
    fontSize: 15,
  },
  clearBtn: { paddingHorizontal: 12 },

  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 12,
  },
  currentIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  currentLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  currentSub: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 2 },

  divider: { height: StyleSheet.hairlineWidth, marginHorizontal: 16, marginBottom: 4 },

  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 12,
  },
  resultIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultName: { fontFamily: 'Manrope_500Medium', fontSize: 14 },

  sep: { height: StyleSheet.hairlineWidth, marginHorizontal: 16 },

  state: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 14, textAlign: 'center' },
  retry: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
});
