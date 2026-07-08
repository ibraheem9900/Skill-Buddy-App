import React from 'react';
import { FlatList, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { useBookmarks } from '@/context/BookmarkContext';
import ServiceCard from '@/components/ServiceCard';
import EmptyState from '@/components/EmptyState';

const c = colors.light;

export default function BookmarksScreen() {
  const insets = useSafeAreaInsets();
  const { bookmarks } = useBookmarks();
  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title}>Saved Services</Text>
        <Text style={styles.count}>{bookmarks.length} saved</Text>
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
          contentContainerStyle={{ padding: 16, paddingBottom: TAB_HEIGHT + 16 }}
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
  root: { flex: 1, backgroundColor: '#F8F8F8' },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  title: { fontFamily: 'Inter_700Bold', fontSize: 20, color: '#1A1A1A' },
  count: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#737373' },
});
