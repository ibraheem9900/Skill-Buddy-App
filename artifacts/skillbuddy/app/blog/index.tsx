import React, { useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { BLOG_CATEGORIES, BLOG_POSTS } from '@/data/blogData';
import BackButton from '@/components/BackButton';

export default function BlogsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);

  const featured = BLOG_POSTS.slice(0, 3);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return BLOG_POSTS.filter((p) => {
      const matchesCat = !category || p.category === category;
      const matchesQ = !q || p.title.toLowerCase().includes(q) || p.excerpt.toLowerCase().includes(q);
      return matchesCat && matchesQ;
    });
  }, [query, category]);

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('blog_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(p) => p.id}
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View style={{ marginBottom: 8 }}>
            <View style={[styles.searchBar, { backgroundColor: c.input }]}>
              <Feather name="search" size={16} color={c.mutedForeground} />
              <TextInput
                style={[styles.searchInput, { color: c.text }]}
                placeholder={t('blog_search')}
                placeholderTextColor={c.mutedForeground}
                value={query}
                onChangeText={setQuery}
              />
            </View>

            {!query && (
              <>
                <Text style={[styles.sectionTitle, { color: c.text }]}>{t('blog_featured')}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 12 }}>
                  {featured.map((post) => (
                    <TouchableOpacity
                      key={post.id}
                      style={[styles.featuredCard, { backgroundColor: c.card, borderColor: c.border }]}
                      onPress={() => router.push(`/blog/${post.id}` as any)}
                    >
                      <Image source={{ uri: post.image }} style={styles.featuredImage} contentFit="cover" />
                      <View style={{ padding: 12 }}>
                        <Text style={[styles.featuredCategory, { color: c.primary }]}>{post.category}</Text>
                        <Text style={[styles.featuredTitle, { color: c.text }]} numberOfLines={2}>{post.title}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginBottom: 16 }}>
              <TouchableOpacity
                style={[styles.catChip, { backgroundColor: !category ? c.primary : c.muted }]}
                onPress={() => setCategory(null)}
              >
                <Text style={[styles.catText, { color: !category ? '#FFF' : c.text }]}>{t('blog_all')}</Text>
              </TouchableOpacity>
              {BLOG_CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.catChip, { backgroundColor: category === cat ? c.primary : c.muted }]}
                  onPress={() => setCategory(cat)}
                >
                  <Text style={[styles.catText, { color: category === cat ? '#FFF' : c.text }]}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={[styles.postCard, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => router.push(`/blog/${item.id}` as any)}
          >
            <Image source={{ uri: item.image }} style={styles.postImage} contentFit="cover" />
            <View style={{ flex: 1, padding: 12 }}>
              <Text style={[styles.postCategory, { color: c.primary }]}>{item.category}</Text>
              <Text style={[styles.postTitle, { color: c.text }]} numberOfLines={2}>{item.title}</Text>
              <Text style={[styles.postMeta, { color: c.mutedForeground }]}>{item.date} · {item.readTime}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 16 },
  searchInput: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14 },
  sectionTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, marginBottom: 10 },
  featuredCard: { width: 220, borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  featuredImage: { width: '100%', height: 110 },
  featuredCategory: { fontFamily: 'Manrope_600SemiBold', fontSize: 10, marginBottom: 3 },
  featuredTitle: { fontFamily: 'Manrope_700Bold', fontSize: 13, lineHeight: 18 },
  catChip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10 },
  catText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
  postCard: { flexDirection: 'row', borderWidth: 1, borderRadius: 14, marginBottom: 12, overflow: 'hidden' },
  postImage: { width: 100, height: 100 },
  postCategory: { fontFamily: 'Manrope_600SemiBold', fontSize: 10, marginBottom: 3 },
  postTitle: { fontFamily: 'Manrope_700Bold', fontSize: 13, lineHeight: 18 },
  postMeta: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 6 },
});
