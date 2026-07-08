import React from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';

const LOGO_WHITE = require('@/assets/images/logo-white.png');

const c = colors.light;

interface MenuItem {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  route?: string;
  action?: () => void;
  color?: string;
  badge?: string;
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();
  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;

  const name = user ? `${user.first_name} ${user.last_name}` : 'Guest User';
  const email = user?.email ?? 'user@skillbuddy.com';

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: logout },
    ]);
  };

  const SECTIONS: { title: string; items: MenuItem[] }[] = [
    {
      title: 'General',
      items: [
        { icon: 'user', label: 'Personal Information', route: '/profile/edit' },
        { icon: 'briefcase', label: 'Professional Info' },
        { icon: 'file-text', label: 'Documents' },
        { icon: 'star', label: 'Credit Points', badge: `${user?.credit_points ?? 0} pts` },
      ],
    },
    {
      title: 'Payments',
      items: [
        { icon: 'credit-card', label: 'Payment Methods' },
        { icon: 'dollar-sign', label: 'Wallet & Earnings' },
        { icon: 'clock', label: 'Transaction History' },
      ],
    },
    {
      title: 'Support',
      items: [
        { icon: 'help-circle', label: 'Help & Support' },
        { icon: 'message-circle', label: 'Contact Support' },
        { icon: 'book-open', label: 'FAQs' },
        { icon: 'shield', label: 'Privacy & Policy' },
        { icon: 'file', label: 'Terms & Conditions' },
        { icon: 'info', label: 'About Us' },
      ],
    },
    {
      title: '',
      items: [
        { icon: 'log-out', label: 'Log Out', action: handleLogout, color: c.destructive },
      ],
    },
  ];

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={{ paddingBottom: TAB_HEIGHT + 20 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile Header */}
      <View style={[styles.profileHeader, { paddingTop: insets.top + 12 }]}>
        {/* Logo at top of profile header */}
        <Image source={LOGO_WHITE} style={styles.headerLogo} contentFit="contain" />
        <View style={styles.avatarWrap}>
          <View style={[styles.avatar, { backgroundColor: c.primary }]}>
            <Text style={styles.avatarText}>{user?.first_name?.charAt(0) ?? 'U'}</Text>
          </View>
          <TouchableOpacity style={[styles.editAvatarBtn, { backgroundColor: c.primary }]}>
            <Feather name="camera" size={14} color="#FFF" />
          </TouchableOpacity>
        </View>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.email}>{email}</Text>
        {user?.role && (
          <View style={[styles.roleBadge, { backgroundColor: c.primaryLight }]}>
            <Text style={[styles.roleText, { color: c.primary }]}>{user.role}</Text>
          </View>
        )}
      </View>

      {/* Stats Row */}
      <Animated.View entering={FadeInDown.delay(80).duration(400)}>
        <View style={styles.statsRow}>
          {[
            { label: 'Jobs Done', value: user?.jobs_done ?? 24 },
            { label: 'Active Jobs', value: user?.active_jobs ?? 2 },
            { label: 'Credit Pts', value: user?.credit_points ?? 48 },
          ].map((stat, i) => (
            <View key={i} style={styles.statItem}>
              <Text style={[styles.statValue, { color: c.primary }]}>{stat.value}</Text>
              <Text style={styles.statLabel}>{stat.label}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Menu Sections */}
      {SECTIONS.map((section, si) => (
        <Animated.View key={si} entering={FadeInDown.delay(120 + si * 40).duration(350)}>
          {section.title ? <Text style={styles.sectionTitle}>{section.title}</Text> : <View style={{ height: 16 }} />}
          <View style={styles.menuCard}>
            {section.items.map((item, ii) => (
              <TouchableOpacity
                key={ii}
                style={[styles.menuItem, ii < section.items.length - 1 && styles.menuItemBorder]}
                onPress={item.action ?? (() => item.route && router.push(item.route as any))}
                activeOpacity={0.7}
              >
                <View style={[styles.menuIcon, { backgroundColor: item.color ? '#FFF0EF' : c.primaryLight }]}>
                  <Feather name={item.icon} size={18} color={item.color ?? c.primary} />
                </View>
                <Text style={[styles.menuLabel, item.color && { color: item.color }]}>{item.label}</Text>
                {item.badge ? (
                  <View style={[styles.badge, { backgroundColor: c.primaryLight }]}>
                    <Text style={[styles.badgeText, { color: c.primary }]}>{item.badge}</Text>
                  </View>
                ) : !item.action ? (
                  <Feather name="chevron-right" size={18} color="#CBCBCB" />
                ) : null}
              </TouchableOpacity>
            ))}
          </View>
        </Animated.View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8F8F8' },
  profileHeader: { backgroundColor: c.primary, alignItems: 'center', paddingBottom: 28, paddingHorizontal: 20 },
  headerLogo: { width: 130, height: 40, marginBottom: 16 },
  avatarWrap: { position: 'relative', marginBottom: 12 },
  avatar: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.4)' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 36, color: '#FFF' },
  editAvatarBtn: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF' },
  name: { fontFamily: 'Inter_700Bold', fontSize: 20, color: '#FFF', marginBottom: 2 },
  email: { fontFamily: 'Inter_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.8)', marginBottom: 10 },
  roleBadge: { paddingHorizontal: 14, paddingVertical: 4, borderRadius: 20 },
  roleText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  statsRow: { flexDirection: 'row', backgroundColor: '#FFF', marginHorizontal: 16, borderRadius: 16, marginTop: -20, elevation: 4, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 8 },
  statItem: { flex: 1, alignItems: 'center', paddingVertical: 16 },
  statValue: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  statLabel: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#737373', marginTop: 2 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#737373', marginTop: 20, marginBottom: 8, paddingHorizontal: 20, textTransform: 'uppercase', letterSpacing: 0.5 },
  menuCard: { backgroundColor: '#FFF', marginHorizontal: 16, borderRadius: 16, overflow: 'hidden' },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  menuItemBorder: { borderBottomWidth: 1, borderBottomColor: '#F5F5F5' },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { flex: 1, fontFamily: 'Inter_500Medium', fontSize: 14, color: '#1A1A1A' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  badgeText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
});
