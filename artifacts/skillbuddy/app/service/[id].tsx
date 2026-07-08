import React, { useState } from 'react';
import {
  Dimensions,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Feather, MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeIn } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { SERVICES, REVIEWS } from '@/data/mockData';
import RatingStars from '@/components/RatingStars';
import { useBookmarks } from '@/context/BookmarkContext';

const c = colors.light;
const W = Dimensions.get('window').width;

const TABS = ['About', 'Gallery', 'Reviews'] as const;
type Tab = (typeof TABS)[number];

export default function ServiceDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isBookmarked, toggleBookmark } = useBookmarks();

  const service = SERVICES.find((s) => s.id === id) ?? SERVICES[0];
  const reviews = REVIEWS.slice(0, 4);

  const [activeTab, setActiveTab] = useState<Tab>('About');
  const [selectedImage, setSelectedImage] = useState(0);

  const images = [service.image, ...reviews.map((r) => r.reviewerAvatar)].slice(0, 5);

  const bookmarked = isBookmarked(service.id);

  return (
    <View style={styles.root}>
      {/* Hero */}
      <View style={{ height: 300 }}>
        <Image source={{ uri: images[selectedImage] }} style={styles.heroImage} contentFit="cover" />
        {/* Back / Bookmark */}
        <View style={[styles.heroOverlay, { top: insets.top + 8 }]}>
          <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}>
            <Feather name="arrow-left" size={20} color="#1A1A1A" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconBtn} onPress={() => toggleBookmark(service)}>
            <MaterialIcons
              name={bookmarked ? 'bookmark' : 'bookmark-border'}
              size={22}
              color={bookmarked ? c.primary : '#1A1A1A'}
            />
          </TouchableOpacity>
        </View>
        {/* Thumbnail strip */}
        <FlatList
          data={images}
          keyExtractor={(_, i) => String(i)}
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.thumbStrip}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
          renderItem={({ item, index }) => (
            <TouchableOpacity onPress={() => setSelectedImage(index)} activeOpacity={0.8}>
              <Image
                source={{ uri: item }}
                style={[
                  styles.thumb,
                  index === selectedImage && { borderWidth: 2, borderColor: c.primary },
                ]}
                contentFit="cover"
              />
            </TouchableOpacity>
          )}
        />
      </View>

      <ScrollView style={styles.body} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* Title row */}
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{service.title}</Text>
            <Text style={styles.categoryLabel}>{service.category}</Text>
          </View>
          <View style={styles.priceBox}>
            <Text style={styles.price}>${service.price}</Text>
            <Text style={styles.priceUnit}>/ hr</Text>
          </View>
        </View>

        {/* Provider row */}
        <View style={styles.providerRow}>
          <Image source={{ uri: service.providerAvatar }} style={styles.providerAvatar} contentFit="cover" />
          <View style={{ flex: 1 }}>
            <Text style={styles.providerName}>{service.provider}</Text>
            <Text style={styles.providerSub}>Professional</Text>
          </View>
          <RatingStars rating={service.rating} size={14} />
          <Text style={styles.ratingCount}>({service.reviewCount})</Text>
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          {[
            { label: 'Projects', value: '84+' },
            { label: 'Satisfied', value: '97%' },
            { label: 'Experience', value: '5 yrs' },
          ].map((stat) => (
            <View key={stat.label} style={styles.statItem}>
              <Text style={styles.statValue}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>

        {/* Tabs */}
        <View style={styles.tabRow}>
          {TABS.map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tab, activeTab === tab && { borderBottomColor: c.primary, borderBottomWidth: 2 }]}
              onPress={() => setActiveTab(tab)}
            >
              <Text style={[styles.tabText, activeTab === tab && { color: c.primary }]}>{tab}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Tab content */}
        {activeTab === 'About' && (
          <Animated.View entering={FadeIn} style={{ paddingHorizontal: 20, paddingTop: 16 }}>
            <Text style={styles.sectionTitle}>Description</Text>
            <Text style={styles.body2}>
              {service.description ??
                `${service.provider} is a highly skilled professional with years of experience in ${service.category}. They provide top-quality ${service.title.toLowerCase()} services tailored to your needs. Available for projects across Estonia, Latvia, and Lithuania.`}
            </Text>
            <Text style={[styles.sectionTitle, { marginTop: 20 }]}>What's Included</Text>
            {['Free consultation', 'Initial assessment', 'Full service delivery', 'Post-service support'].map((item) => (
              <View key={item} style={styles.includeRow}>
                <Feather name="check-circle" size={16} color={c.primary} />
                <Text style={styles.includeText}>{item}</Text>
              </View>
            ))}
          </Animated.View>
        )}

        {activeTab === 'Gallery' && (
          <Animated.View entering={FadeIn} style={{ paddingHorizontal: 16, paddingTop: 16 }}>
            <View style={styles.galleryGrid}>
              {images.map((img, i) => (
                <TouchableOpacity key={i} onPress={() => setSelectedImage(i)} activeOpacity={0.85}>
                  <Image
                    source={{ uri: img }}
                    style={styles.galleryItem}
                    contentFit="cover"
                  />
                </TouchableOpacity>
              ))}
            </View>
          </Animated.View>
        )}

        {activeTab === 'Reviews' && (
          <Animated.View entering={FadeIn} style={{ paddingTop: 16 }}>
            {reviews.map((review) => (
              <View key={review.id} style={styles.reviewCard}>
                <View style={styles.reviewHeader}>
                  <Image source={{ uri: review.reviewerAvatar }} style={styles.reviewerAvatar} contentFit="cover" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.reviewerName}>{review.reviewerName}</Text>
                    <Text style={styles.reviewDate}>{review.date}</Text>
                  </View>
                  <RatingStars rating={review.rating} size={13} />
                </View>
                <Text style={styles.reviewText}>{review.comment}</Text>
              </View>
            ))}
          </Animated.View>
        )}
      </ScrollView>

      {/* Bottom Bar */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity style={[styles.chatBtn, { borderColor: c.primary }]}>
          <Feather name="message-circle" size={20} color={c.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.bookBtn, { backgroundColor: c.primary }]}
          onPress={() => router.push(`/booking/${service.id}` as any)}
        >
          <Text style={styles.bookBtnText}>Book Now</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF' },
  heroImage: { width: '100%', height: 300 },
  heroOverlay: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.9)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 4, elevation: 2 },
  thumbStrip: { position: 'absolute', bottom: 12 },
  thumb: { width: 56, height: 56, borderRadius: 10 },
  body: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 20, paddingTop: 20, gap: 12 },
  title: { fontFamily: 'Inter_700Bold', fontSize: 18, color: '#1A1A1A', flex: 1 },
  categoryLabel: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#737373', marginTop: 2 },
  priceBox: { flexDirection: 'row', alignItems: 'flex-end', gap: 2 },
  price: { fontFamily: 'Inter_700Bold', fontSize: 22, color: c.primary },
  priceUnit: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#737373', marginBottom: 3 },
  providerRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, marginTop: 16, gap: 10 },
  providerAvatar: { width: 42, height: 42, borderRadius: 21 },
  providerName: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#1A1A1A' },
  providerSub: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#737373', marginTop: 2 },
  ratingCount: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#737373' },
  statsRow: { flexDirection: 'row', marginHorizontal: 20, marginTop: 20, padding: 16, borderRadius: 16, backgroundColor: '#F8F8F8', justifyContent: 'space-around' },
  statItem: { alignItems: 'center' },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#1A1A1A' },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#737373', marginTop: 2 },
  tabRow: { flexDirection: 'row', marginTop: 20, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#737373' },
  sectionTitle: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#1A1A1A', marginBottom: 8 },
  body2: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#555', lineHeight: 22 },
  includeRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  includeText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#1A1A1A' },
  galleryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  galleryItem: { width: (W - 40) / 2, height: (W - 40) / 2, borderRadius: 12 },
  reviewCard: { marginHorizontal: 20, marginBottom: 16, padding: 16, borderRadius: 16, backgroundColor: '#F8F8F8' },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  reviewerAvatar: { width: 38, height: 38, borderRadius: 19 },
  reviewerName: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#1A1A1A' },
  reviewDate: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#737373', marginTop: 2 },
  reviewText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#555', lineHeight: 20 },
  bottomBar: { flexDirection: 'row', paddingHorizontal: 20, paddingTop: 14, gap: 12, borderTopWidth: 1, borderTopColor: '#F0F0F0', backgroundColor: '#FFF' },
  chatBtn: { width: 50, height: 50, borderRadius: 25, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  bookBtn: { flex: 1, borderRadius: 28, paddingVertical: 14, alignItems: 'center' },
  bookBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#FFF' },
});
