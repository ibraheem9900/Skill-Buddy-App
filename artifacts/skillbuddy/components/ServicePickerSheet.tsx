import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import BottomSheet from '@/components/BottomSheet';
import InlineLoader from '@/components/InlineLoader';
import useCategories from '@/hooks/useCategories';
import useCategoryServices from '@/hooks/useCategoryServices';
import type { ServiceListItem } from '@/types';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (service: ServiceListItem) => void;
  selectedId: number | null;
}

/**
 * Cascading service picker: CATEGORY first, then only the services in that
 * category. The global catalog is never rendered as a flat list — the brief
 * for Issue 1 forbids it. Both steps come from the real API
 * (GET /api/v1/categories and GET /api/v1/categories/{id}/services).
 */
export default function ServicePickerSheet({ visible, onClose, onSelect, selectedId }: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  const { status: categoriesStatus, categories, load: loadCategories, refresh: refreshCategories } =
    useCategories();

  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [categoryName, setCategoryName] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const { status: servicesStatus, services, refresh: refreshServices } =
    useCategoryServices(visible ? categoryId : null, visible);

  useEffect(() => {
    if (!visible) return;
    void loadCategories();
  }, [visible, loadCategories]);

  // Every fresh open starts at step one, so the user is never dropped into a
  // service list for a category they cannot see.
  useEffect(() => {
    if (!visible) return;
    setCategoryId(null);
    setCategoryName(null);
    setSearch('');
  }, [visible]);

  const query = search.trim().toLowerCase();

  const visibleCategories = useMemo(
    () =>
      (categories ?? []).filter((cat) => !query || cat.name.toLowerCase().includes(query)),
    [categories, query]
  );

  const openCategory = (id: number, name: string) => {
    setCategoryId(id);
    setCategoryName(name);
    setSearch('');
  };

  const backToCategories = () => {
    setCategoryId(null);
    setCategoryName(null);
  };

  const renderCategories = () => {
    if (categoriesStatus === 'loading' || categoriesStatus === 'idle') {
      return (
        <View style={styles.state}>
          <InlineLoader size={22} />
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('cats_loading')}</Text>
        </View>
      );
    }
    if (categoriesStatus === 'error') {
      return (
        <View style={styles.state}>
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>{t('cats_error')}</Text>
          <TouchableOpacity onPress={() => void refreshCategories()} hitSlop={6}>
            <Text style={[styles.stateAction, { color: c.primary }]}>{t('cats_retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (visibleCategories.length === 0) {
      return (
        <View style={styles.state}>
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>
            {query ? t('geo_no_match') : t('cats_empty')}
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.rows}>
        {visibleCategories.map((cat) => (
          <TouchableOpacity
            key={cat.id}
            style={[styles.row, { backgroundColor: c.input, borderColor: c.border }]}
            onPress={() => openCategory(cat.id, cat.name)}
            accessibilityRole="button"
          >
            <Text style={[styles.rowText, { color: c.text }]} numberOfLines={1}>
              {cat.name}
            </Text>
            <Feather name="chevron-right" size={17} color={c.mutedForeground} />
          </TouchableOpacity>
        ))}
      </View>
    );
  };

  const renderServices = () => {
    if (servicesStatus === 'loading' || servicesStatus === 'idle') {
      return (
        <View style={styles.state}>
          <InlineLoader size={22} />
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>
            {t('services_loading')}
          </Text>
        </View>
      );
    }
    if (servicesStatus === 'error' || servicesStatus === 'invalid' || servicesStatus === 'notfound') {
      return (
        <View style={styles.state}>
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>
            {t('services_load_error')}
          </Text>
          <TouchableOpacity onPress={() => void refreshServices()} hitSlop={6}>
            <Text style={[styles.stateAction, { color: c.primary }]}>{t('cats_retry')}</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (!services || services.length === 0) {
      return (
        <View style={styles.state}>
          <Text style={[styles.stateText, { color: c.mutedForeground }]}>
            {t('catd_services_empty')}
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.rows}>
        {services.map((service) => {
          const active = service.id === selectedId;
          return (
            <TouchableOpacity
              key={service.id}
              style={[
                styles.row,
                {
                  backgroundColor: active ? c.primaryLight : c.input,
                  borderColor: active ? c.primary : c.border,
                },
              ]}
              onPress={() => onSelect(service)}
              accessibilityRole="button"
            >
              <Text style={[styles.rowText, { color: c.text }]} numberOfLines={1}>
                {service.title}
              </Text>
              {active ? <Feather name="check-circle" size={17} color={c.primary} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const step = categoryId == null ? 'category' : 'service';

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={step === 'category' ? t('post_svc_pick_category') : t('post_svc_pick_title')}
      header={
        step === 'category' ? (
          <View style={[styles.searchRow, { borderBottomColor: c.border }]}>
            <Feather name="search" size={15} color={c.mutedForeground} />
            <TextInput
              style={[styles.searchInput, { color: c.text }]}
              placeholder={t('geo_search')}
              placeholderTextColor={c.mutedForeground}
              value={search}
              onChangeText={setSearch}
              autoCorrect={false}
            />
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.crumb, { borderBottomColor: c.border }]}
            onPress={backToCategories}
            accessibilityRole="button"
            accessibilityLabel={t('post_svc_back_categories')}
          >
            <Feather name="chevron-left" size={16} color={c.primary} />
            <Text style={[styles.crumbText, { color: c.primary }]} numberOfLines={1}>
              {categoryName ?? t('post_svc_back_categories')}
            </Text>
          </TouchableOpacity>
        )
      }
    >
      <Animated.View
        key={step}
        entering={FadeIn.duration(180)}
        exiting={FadeOut.duration(120)}
        style={styles.body}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 'category' ? renderCategories() : renderServices()}
        </ScrollView>
      </Animated.View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  scroll: { padding: 16 },
  rows: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowText: { flex: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  searchInput: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, paddingVertical: 2 },
  crumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: 1,
  },
  crumbText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, flex: 1 },
  state: { paddingVertical: 40, alignItems: 'center', gap: 10 },
  stateText: { fontFamily: 'Manrope_400Regular', fontSize: 12, textAlign: 'center' },
  stateAction: { fontFamily: 'Manrope_700Bold', fontSize: 12 },
});
