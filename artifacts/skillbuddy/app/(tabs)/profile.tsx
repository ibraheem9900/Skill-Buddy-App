import React, { useRef } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import { CURRENT_USER } from '@/data/mockData';
import LogoImage from '@/components/LogoImage';

interface MenuItem {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  route?: string;
  action?: () => void;
  color?: string;
  badge?: string;
  isThemeToggle?: boolean;
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { logout } = useAuth();
  const { colors: c, theme, toggleTheme } = useTheme();
  const { activeRole, isBothRoles, toggleRole } = useRole();
  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;

  const toggleBtnRef = useRef<View>(null);

  // Consistent, single source of truth for the logged-in identity — matches
  // Home's greeting and the Jobs client identity, so a name change anywhere
  // (CURRENT_USER) reflects everywhere.
  const name = CURRENT_USER.name;
  const email = CURRENT_USER.email;

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: logout },
    ]);
  };

  const handleThemeToggle = () => {
    if (toggleBtnRef.current) {
      toggleBtnRef.current.measure(
        (_x: number, _y: number, w: number, h: number, pageX: number, pageY: number) => {
          toggleTheme(pageX + w / 2, pageY + h / 2);
        }
      );
    } else {
      toggleTheme();
    }
  };

  const clientSections: { title: string; items: MenuItem[] }[] = [
    {
      title: 'General',
      items: [
        { icon: 'user', label: 'Personal Information', route: '/profile/edit' },
        { icon: 'briefcase', label: 'Professional Info', route: '/profile/professional' },
        { icon: 'file-text', label: 'Documents', route: '/profile/documents' },
        { icon: 'star', label: 'Credit Points', route: '/profile/credit-points', badge: `${CURRENT_USER.creditPoints} pts` },
      ],
    },
    {
      title: 'Payments',
      items: [
        { icon: 'credit-card', label: 'Wallet & Payments', route: '/profile/wallet' },
      ],
    },
    {
      title: 'Settings',
      items: [
        { icon: 'sliders', label: 'Settings', route: '/profile/settings' },
        {
          icon: theme === 'dark' ? 'sun' : 'moon',
          label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
          action: handleThemeToggle,
          isThemeToggle: true,
        },
      ],
    },
    {
      title: 'Support & Safety',
      items: [
        { icon: 'message-circle', label: 'Chat with Support', route: '/chat/support' },
        { icon: 'shield', label: 'Safety & Help', route: '/profile/safety' },
        { icon: 'book-open', label: 'FAQs', route: '/profile/faqs' },
        { icon: 'info', label: 'About Us', route: '/profile/legal?type=about' },
        { icon: 'file', label: 'Privacy & Cookie Policy', route: '/profile/legal?type=privacy' },
        { icon: 'shield', label: 'Terms & Conditions', route: '/profile/legal?type=terms' },
      ],
    },
    {
      title: '',
      items: [
        { icon: 'log-out', label: 'Log Out', action: handleLogout, color: c.destructive },
      ],
    },
  ];

  const providerSections: { title: string; items: MenuItem[] }[] = [
    {
      title: 'General',
      items: [
        { icon: 'user', label: 'Personal Information', route: '/profile/edit' },
        { icon: 'award', label: 'Professional Info', route: '/profile/professional' },
        { icon: 'file-text', label: 'Documents', route: '/profile/documents' },
      ],
    },
    {
      title: 'Earnings',
      items: [
        { icon: 'dollar-sign', label: 'Wallet & Earnings', route: '/profile/wallet' },
      ],
    },
    {
      title: 'Settings',
      items: [
        { icon: 'sliders', label: 'Settings', route: '/profile/settings' },
        {
          icon: theme === 'dark' ? 'sun' : 'moon',
          label: theme === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode',
          action: handleThemeToggle,
          isThemeToggle: true,
        },
      ],
    },
    {
      title: 'Support & Safety',
      items: [
        { icon: 'message-circle', label: 'Chat with Support', route: '/chat/support' },
        { icon: 'shield', label: 'Safety & Help', route: '/profile/safety' },
        { icon: 'book-open', label: 'FAQs', route: '/profile/faqs' },
      ],
    },
    {
      title: '',
      items: [
        { icon: 'log-out', label: 'Log Out', action: handleLogout, color: c.destructive },
      ],
    },
  ];

  const SECTIONS = activeRole === 'CLIENT' ? clientSections : providerSections;

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: c.background }]}
      contentContainerStyle={{ paddingBottom: TAB_HEIGHT + insets.bottom + 20 }}
      showsVerticalScrollIndicator={false}
    >
      {/* Profile Header */}
      <View style={[styles.profileHeader, { backgroundColor: c.headerBg, paddingTop: insets.top + 12 }]}>
        {/* Logo mark + theme toggle row — real brand asset, consistent size with Home header */}
        <View style={styles.headerTopRow}>
          <LogoImage variant="white" height={52} />
          <View ref={toggleBtnRef} collapsable={false}>
            <TouchableOpacity
              style={styles.themeToggleBtn}
              onPress={handleThemeToggle}
              activeOpacity={0.75}
            >
              <Feather name={theme === 'dark' ? 'sun' : 'moon'} size={18} color="#FFF" />
            </TouchableOpacity>
          </View>
        </View>

        {isBothRoles && (
          <View style={styles.roleSwitchWrap}>
            <TouchableOpacity
              style={[styles.roleSwitchOption, activeRole === 'CLIENT' && styles.roleSwitchActive]}
              onPress={() => activeRole !== 'CLIENT' && toggleRole()}
            >
              <Text style={[styles.roleSwitchText, activeRole === 'CLIENT' && { color: c.primary }]}>Client</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.roleSwitchOption, activeRole === 'PROVIDER' && styles.roleSwitchActive]}
              onPress={() => activeRole !== 'PROVIDER' && toggleRole()}
            >
              <Text style={[styles.roleSwitchText, activeRole === 'PROVIDER' && { color: c.primary }]}>SkillBuddy Pilot</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.avatarWrap}>
          <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.4)' }]}>
            <Text style={styles.avatarText}>{CURRENT_USER.firstName.charAt(0)}</Text>
          </View>
          <TouchableOpacity style={[styles.editAvatarBtn, { backgroundColor: c.primary, borderColor: '#FFF' }]}>
            <Feather name="camera" size={14} color="#FFF" />
          </TouchableOpacity>
        </View>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.email}>{email}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{activeRole === 'CLIENT' ? 'Client' : 'SkillBuddy Pilot'}</Text>
        </View>
      </View>

      {/* Stats Row */}
      <Animated.View entering={FadeInDown.delay(80).duration(400)}>
        <View style={[styles.statsRow, { backgroundColor: c.card, shadowColor: '#000' }]}>
          {[
            { label: 'Jobs Done', value: CURRENT_USER.jobsDone },
            { label: 'Active Jobs', value: CURRENT_USER.activeJobs },
            { label: 'Credit Pts', value: CURRENT_USER.creditPoints },
          ].map((stat, i) => (
            <View key={i} style={[styles.statItem, i < 2 && { borderRightWidth: 1, borderRightColor: c.border }]}>
              <Text style={[styles.statValue, { color: c.primary }]}>{stat.value}</Text>
              <Text style={[styles.statLabel, { color: c.mutedForeground }]}>{stat.label}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Menu Sections */}
      {SECTIONS.map((section, si) => (
        <Animated.View key={si} entering={FadeInDown.delay(120 + si * 40).duration(350)}>
          {section.title ? (
            <Text style={[styles.sectionTitle, { color: c.mutedForeground }]}>{section.title}</Text>
          ) : (
            <View style={{ height: 16 }} />
          )}
          <View style={[styles.menuCard, { backgroundColor: c.card, borderColor: c.border }]}>
            {section.items.map((item, ii) => (
              <TouchableOpacity
                key={ii}
                style={[
                  styles.menuItem,
                  ii < section.items.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.border },
                ]}
                onPress={item.action ?? (() => item.route && router.push(item.route as any))}
                activeOpacity={0.7}
              >
                <View
                  style={[
                    styles.menuIcon,
                    { backgroundColor: item.color ? c.urgentLight : c.accent },
                  ]}
                >
                  <Feather name={item.icon} size={18} color={item.color ?? c.primary} />
                </View>
                <Text style={[styles.menuLabel, { color: item.color ?? c.text }]}>{item.label}</Text>
                {item.badge ? (
                  <View style={[styles.badge, { backgroundColor: c.primaryLight }]}>
                    <Text style={[styles.badgeText, { color: c.primary }]}>{item.badge}</Text>
                  </View>
                ) : !item.action ? (
                  <Feather name="chevron-right" size={18} color={c.border} />
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
  root: { flex: 1 },
  profileHeader: {
    alignItems: 'center',
    paddingBottom: 28,
    paddingHorizontal: 20,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 16,
  },
  themeToggleBtn: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  roleSwitchWrap: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    padding: 3,
    marginBottom: 16,
  },
  roleSwitchOption: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 9 },
  roleSwitchActive: { backgroundColor: '#FFFFFF' },
  roleSwitchText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: 'rgba(255,255,255,0.85)' },
  avatarWrap: { position: 'relative', marginBottom: 12 },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
  },
  avatarText: { fontFamily: 'Manrope_700Bold', fontSize: 36, color: '#FFF' },
  editAvatarBtn: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  name: { fontFamily: 'Manrope_700Bold', fontSize: 20, color: '#FFF', marginBottom: 2 },
  email: { fontFamily: 'Manrope_400Regular', fontSize: 13, color: 'rgba(255,255,255,0.8)', marginBottom: 10 },
  roleBadge: {
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  roleText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#FFF' },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 16,
    borderRadius: 16,
    marginTop: -20,
    elevation: 4,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
  },
  statItem: { flex: 1, alignItems: 'center', paddingVertical: 16 },
  statValue: { fontFamily: 'Manrope_700Bold', fontSize: 20 },
  statLabel: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 2 },
  sectionTitle: {
    fontFamily: 'Manrope_600SemiBold',
    fontSize: 12,
    marginTop: 20,
    marginBottom: 8,
    paddingHorizontal: 20,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  menuCard: { marginHorizontal: 16, borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuLabel: { flex: 1, fontFamily: 'Manrope_500Medium', fontSize: 14 },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  badgeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12 },
});
