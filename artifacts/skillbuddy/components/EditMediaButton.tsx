/**
 * EditMediaButton — the ready-to-use "edit this photo" control.
 *
 * It is the second half of the edit entry pair: `openEditMedia(item)` opens the
 * editor, and this wraps it in the app's button styling with a pencil icon.
 * Render it ONLY where ownership is certain (My media / a future owned-media
 * list) — public gallery rows carry no owner id, so they must never show it.
 *
 * Two shapes:
 *   • `compact` — a 40×40 circular icon button for a viewer header or a tile
 *     corner (min touch target respected; the viewer uses its own pencil, this
 *     is for tile menus).
 *   • default — an icon + label pill for a list row / sheet action.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { openEditMedia } from '@/components/EditMediaSheet';
import type { MediaEditable } from '@/lib/mediaEdit';
import type { MediaItem } from '@/types';

interface Props {
  /** The owner's own media row (never a public-gallery row). */
  item: MediaEditable;
  /** Circle with only a pencil (viewer header / tile corner). */
  compact?: boolean;
  /** Optional override for the pill's label (already translated). */
  label?: string;
  /** Lets the opener react to the confirmed PATCH response. */
  onSaved?: (item: MediaItem) => void;
}

export default function EditMediaButton({ item, compact = false, label, onSaved }: Props) {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const text = label ?? t('media_edit_action');

  if (compact) {
    return (
      <TouchableOpacity
        onPress={() => openEditMedia(item, { onSaved })}
        style={[styles.icon, { backgroundColor: c.primary }]}
        accessibilityRole="button"
        accessibilityLabel={text}
        activeOpacity={0.85}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Feather name="edit-2" size={16} color={c.primaryForeground} />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={() => openEditMedia(item, { onSaved })}
      style={[styles.pill, { backgroundColor: c.primaryLight, borderColor: c.border }]}
      accessibilityRole="button"
      accessibilityLabel={text}
      activeOpacity={0.85}
    >
      <View style={styles.pillInner}>
        <Feather name="edit-2" size={13} color={c.primary} />
        <Text style={[styles.pillText, { color: c.primary }]} numberOfLines={1}>
          {text}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    minHeight: 36,
    justifyContent: 'center',
  },
  pillInner: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillText: { flexShrink: 1, fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
});
