import React, { useMemo } from 'react';
import { ScrollView, Share, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useTheme } from '@/context/ThemeContext';
import { BLOG_POSTS } from '@/data/blogData';
import BackButton from '@/components/BackButton';

export default function BlogDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();

  const post = BLOG_POSTS.find((p) => p.id === id);
  const related = useMemo(
    () => (post ? BLOG_POSTS.filter((p) => p.category === post.category && p.id !== post.id).slice(0, 3) : []),
    [post]
  );

  if (!post) {
    return (
      <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
        <Text style={{ color: c.text, padding: 20 }}>Article not found.</Text>
      </View>
    );
  }

  const onShare = () => {
    Share.share({
      title: post.title,
      message: `${post.title} — SkillBuddy Blog\n${post.excerpt}`,
    });
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <TouchableOpacity onPress={onShare}>
          <Feather name="share-2" size={20} color={c.text} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
        <Image source={{ uri: post.image }} style={styles.hero} contentFit="cover" />
        <View style={{ padding: 20 }}>
          <Text style={[styles.category, { color: c.primary }]}>{post.category}</Text>
          <Text style={[styles.title, { color: c.text }]}>{post.title}</Text>
          <Text style={[styles.meta, { color: c.mutedForeground }]}>{post.author} · {post.date} · {post.readTime}</Text>

          {post.body.map((para, i) => (
            <Text key={i} style={[styles.paragraph, { color: c.text }]}>{para}</Text>
          ))}

          {related.length > 0 && (
            <>
              <Text style={[styles.relatedTitle, { color: c.text }]}>Related Articles</Text>
              {related.map((r) => (
                <TouchableOpacity
                  key={r.id}
                  style={[styles.relatedCard, { backgroundColor: c.card, borderColor: c.border }]}
                  onPress={() => router.push(`/blog/${r.id}` as any)}
                >
                  <Image source={{ uri: r.image }} style={styles.relatedImage} contentFit="cover" />
                  <View style={{ flex: 1, padding: 10 }}>
                    <Text style={[styles.relatedCardTitle, { color: c.text }]} numberOfLines={2}>{r.title}</Text>
                    <Text style={[styles.relatedMeta, { color: c.mutedForeground }]}>{r.readTime}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hero: { width: '100%', height: 240 },
  category: { fontFamily: 'Manrope_700Bold', fontSize: 12, marginBottom: 6 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 22, lineHeight: 30, marginBottom: 8 },
  meta: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginBottom: 18 },
  paragraph: { fontFamily: 'Manrope_400Regular', fontSize: 15, lineHeight: 24, marginBottom: 16 },
  relatedTitle: { fontFamily: 'Manrope_700Bold', fontSize: 16, marginTop: 12, marginBottom: 12 },
  relatedCard: { flexDirection: 'row', borderWidth: 1, borderRadius: 12, marginBottom: 10, overflow: 'hidden' },
  relatedImage: { width: 72, height: 72 },
  relatedCardTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, lineHeight: 17 },
  relatedMeta: { fontFamily: 'Manrope_400Regular', fontSize: 10, marginTop: 4 },
});
