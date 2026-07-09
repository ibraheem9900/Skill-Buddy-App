import React from 'react';
import { FlatList, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useBookmarks } from '@/context/BookmarkContext';
import ServiceCard from '@/components/ServiceCard';
import EmptyState from '@/components/EmptyState';

export default function BookmarksScreen() {
  const insets = useSafeAreaInsets();
  const { bookmarks } = useBookmarks();
  const { colors: c } = useTheme();
  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.border }]}>
        <Text style={[styles.title, { color: c.text }]}>Saved Services</Text>
        <Text style={[styles.count, { color: c.mutedForeground }]}>{bookmarks.length} saved</Text>
      </View>

      {bookmarks.length === 0 ? (
        <EmptyState
          icon="bookmark"
          title="No Saved Services"
          subtitle="Services you bookmark will appear here for quick access."
        />
      ) : (
        <FlatList
          data={bookmarks}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: 16, paddingBottom: TAB_HEIGHT + insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>
              <ServiceCard service={item} variant="list" />
            </Animated.View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  count: { fontFamily: 'Inter_400Regular', fontSize: 13 },
});
