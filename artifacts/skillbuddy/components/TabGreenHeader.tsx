/**
 * TabGreenHeader — the ONE green header shared by the Services and Jobs tabs.
 *
 * Extracted from the Services screen so both tabs get the same surface without
 * duplicating code: the green background (c.headerBg) extends behind the status
 * bar, the bottom corners are rounded, the status-bar icons are light while
 * THIS screen is focused (tab screens stay mounted in the pager, so a
 * permanently-mounted StatusBar would leak onto the neighbouring tab), and an
 * optional white search bar + square white filter button sit inside it.
 *
 * Children beyond the fixed slots (title row / search row) are deliberately
 * not supported — the header's job is to look identical wherever it is used.
 */
import React, { useCallback, useState, type ReactNode, type RefObject } from 'react';
import { Platform, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';

export interface HeaderSearchProps {
  value: string;
  /** Typing — must update the visible text immediately. */
  onChange: (text: string) => void;
  /** The X button; falls back to onChange('') when omitted. */
  onClear?: () => void;
  placeholder: string;
  onSubmit?: () => void;
  inputRef?: RefObject<TextInput | null>;
}

export interface HeaderFilterProps {
  /** Badge count (active filters); 0/undefined hides the badge. */
  count?: number;
  onPress: () => void;
  /** accessibilityLabel for the filter button. */
  label?: string;
}

interface Props {
  title: string;
  subtitle?: string | null;
  /** Right side of the title row (e.g. the white "Post a Job" pill). */
  right?: ReactNode | null;
  search?: HeaderSearchProps | null;
  filter?: HeaderFilterProps | null;
}

export default function TabGreenHeader({
  title,
  subtitle,
  right,
  search,
  filter,
}: Props) {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();

  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, [])
  );

  const titleRow = right != null || !!subtitle;

  return (
    <>
      {focused ? <StatusBar style="light" /> : null}
      <View
        style={[
          styles.header,
          { backgroundColor: c.headerBg, paddingTop: insets.top + 10 },
        ]}
      >
        {titleRow ? (
          <View style={styles.titleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {title}
              </Text>
              {subtitle ? (
                <Text style={styles.subtitle} numberOfLines={1}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
            {right ?? null}
          </View>
        ) : (
          <Text style={styles.title}>{title}</Text>
        )}

        {search ? (
          <View style={styles.searchRow}>
            <View style={styles.searchBar}>
              <Feather name="search" size={15} color="#9E9E9E" />
              <TextInput
                ref={search.inputRef}
                style={styles.searchInput}
                value={search.value}
                onChangeText={search.onChange}
                placeholder={search.placeholder}
                placeholderTextColor="#9E9E9E"
                returnKeyType="search"
                onSubmitEditing={() => search.onSubmit?.()}
                autoCorrect={false}
                autoCapitalize="none"
              />
              {search.value.length > 0 ? (
                <TouchableOpacity
                  onPress={() => (search.onClear ?? (() => search.onChange('')))()}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                >
                  <View style={styles.clearBtn}>
                    <Feather name="x" size={12} color="#9E9E9E" />
                  </View>
                </TouchableOpacity>
              ) : null}
            </View>
            {filter ? (
              <TouchableOpacity
                style={styles.filterBtn}
                onPress={filter.onPress}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel={filter.label}
              >
                <Feather name="sliders" size={16} color={c.primary} />
                {filter.count != null && filter.count > 0 ? (
                  <View
                    style={[
                      styles.filterBadge,
                      { backgroundColor: c.destructive, borderColor: c.headerBg },
                    ]}
                  >
                    <Text style={styles.filterBadgeText}>{filter.count}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    gap: 10,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 20,
    color: '#FFF',
  },
  subtitle: {
    fontFamily: 'Manrope_400Regular',
    fontSize: 12,
    color: '#FFF',
    opacity: 0.8,
    marginTop: 2,
  },

  searchRow: { flexDirection: 'row', gap: 8 },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 8,
    backgroundColor: '#FFF',
  },
  searchInput: {
    flex: 1,
    fontFamily: 'Manrope_400Regular',
    fontSize: 13,
    color: '#1A1A1A',
    // Explicit height avoids web rendering quirks. Android: zero vertical
    // padding + centered text — the platform's default textPadding is what
    // made the typed characters invisible inside this small box.
    height: 24,
    paddingVertical: 0,
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  clearBtn: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBtn: {
    backgroundColor: '#FFF',
    width: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  filterBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  filterBadgeText: { fontFamily: 'Manrope_700Bold', fontSize: 9, color: '#FFF' },
});
