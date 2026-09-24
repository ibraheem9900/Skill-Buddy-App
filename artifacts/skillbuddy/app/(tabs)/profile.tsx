import React, { useCallback, useRef } from 'react';
import { Alert, ActivityIndicator, Image, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useRole } from '@/context/RoleContext';
import { CURRENT_USER } from '@/data/mockData';
import LogoImage from '@/components/LogoImage';
import useProfilePictureUpload from '@/hooks/useProfilePictureUpload';
import useClientProfile, { formatAmountSpent } from '@/hooks/useClientProfile';

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
  const { logout, user } = useAuth();
  const { colors: c, theme, toggleTheme } = useTheme();
  const { t } = useLanguage();
  const { activeRole, isBothRoles, toggleRole } = useRole();
  const { pickAndUpload, uploading, removePicture, deleting } = useProfilePictureUpload(!!user?.profile_picture);
  // Client activity stats (GET /api/v1/clients/profile) — fetched only while
  // the CLIENT role is active so provider sessions never hit this endpoint.
  const clientStats = useClientProfile();
  const { activeRole: statsRole } = useRole();
  const statsLoadedFor = useRef<'CLIENT' | 'PROVIDER' | null>(null);
  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;

  // Load once per session per role; refetch when returning to the tab with the
  // CLIENT role active (stats change as bookings progress).
  useFocusEffect(
    useCallback(() => {
      if (statsRole === 'CLIENT') {
        if (statsLoadedFor.current !== 'CLIENT') {
          statsLoadedFor.current = 'CLIENT';
          void clientStats.load();
        }
      } else {
        statsLoadedFor.current = null; // re-arm for the next CLIENT entry
      }
    }, [statsRole]),
  );

  const toggleBtnRef = useRef<View>(null);

  // Prefer the real signed-in user (from signup/login) for identity fields;
  // fall back to mock data only for stats the auth flow doesn't provide yet
  // (jobsDone/activeJobs/creditPoints) and as a last-resort safety net.
  const firstName = user?.first_name || CURRENT_USER.firstName;
  const lastName = user?.last_name || CURRENT_USER.lastName;
  const name = user ? `${firstName} ${lastName}`.trim() : CURRENT_USER.name;
  const email = user?.email || CURRENT_USER.email;
  const profilePicture = user?.profile_picture;

  /** Avatar edit button: with a picture → Change/Remove menu; without → straight to the picker. */
  const handleAvatarAction = () => {
    if (!profilePicture) {
      void pickAndUpload();
      return;
    }
    Alert.alert(t('pp_change_photo'), undefined, [
      { text: t('pp_change_photo'), onPress: () => void pickAndUpload() },
      { text: t('pp_remove_menu'), style: 'destructive', onPress: () => void removePicture() },
      { text: t('action_cancel'), style: 'cancel' },
    ]);
  };

  const handleLogout = () => {
    Alert.alert(t('profile_logout_title'), t('profile_logout_msg'), [
      { text: t('action_cancel'), style: 'cancel' },
      {
        text: t('profile_logout_title'),
        style: 'destructive',
        onPress: async () => {
          // POST /api/v1/auth/logout revokes this device's session server-side.
          // AuthContext.logout() clears local tokens no matter what (401 or
          // network failure still ends in a local logout — routine-action
          // fallback), then we send the user to Login.
          await logout();
          router.replace('/(auth)/login' as any);
        },
      },
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
      title: t('profile_section_general'),
      items: [
        { icon: 'user', label: t('profile_personal_info'), route: '/profile/edit' },
        { icon: 'briefcase', label: t('profile_professional_info'), route: '/profile/professional' },
        { icon: 'file-text', label: t('profile_documents'), route: '/profile/documents' },
        { icon: 'heart', label: t('cf_title'), route: '/profile/favorites' },
        { icon: 'star', label: t('profile_credit_points'), route: '/profile/credit-points', badge: t('profile_pts', { n: CURRENT_USER.creditPoints }) },
      ],
    },
    {
      title: t('profile_section_payments'),
      items: [
        { icon: 'credit-card', label: t('profile_wallet'), route: '/profile/wallet' },
      ],
    },
    {
      title: t('profile_section_settings'),
      items: [
        { icon: 'sliders', label: t('profile_settings'), route: '/profile/settings' },
        {
          icon: theme === 'dark' ? 'sun' : 'moon',
          label: theme === 'dark' ? t('profile_light_mode') : t('profile_dark_mode'),
          action: handleThemeToggle,
          isThemeToggle: true,
        },
      ],
    },
    {
      title: t('profile_section_support'),
      items: [
        { icon: 'message-circle', label: t('profile_support'), route: '/chat/support' },
        { icon: 'file-text', label: t('profile_my_tickets'), route: '/profile/tickets' },
        { icon: 'shield', label: t('profile_safety'), route: '/profile/safety' },
        { icon: 'book-open', label: t('profile_faqs'), route: '/profile/faqs' },
        { icon: 'edit-3', label: t('profile_blog'), route: '/blog' },
        { icon: 'info', label: t('profile_about'), route: '/profile/legal?type=about' },
        { icon: 'file', label: t('profile_privacy'), route: '/profile/legal?type=privacy' },
        { icon: 'shield', label: t('profile_terms'), route: '/profile/legal?type=terms' },
      ],
    },
    {
      title: '',
      items: [
        { icon: 'log-out', label: t('profile_logout'), action: handleLogout, color: c.destructive },
      ],
    },
  ];

  const providerSections: { title: string; items: MenuItem[] }[] = [
    {
      title: t('profile_section_general'),
      items: [
        { icon: 'user', label: t('profile_personal_info'), route: '/profile/edit' },
        { icon: 'award', label: t('profile_professional_info'), route: '/profile/professional' },
        { icon: 'file-text', label: t('profile_documents'), route: '/profile/documents' },
        { icon: 'shield', label: t('cert_title'), route: '/profile/certifications' },
      ],
    },
    {
      title: t('profile_section_earnings'),
      items: [
        { icon: 'dollar-sign', label: t('profile_wallet'), route: '/profile/wallet' },
      ],
    },
    {
      title: t('profile_section_settings'),
      items: [
        { icon: 'sliders', label: t('profile_settings'), route: '/profile/settings' },
        {
          icon: theme === 'dark' ? 'sun' : 'moon',
          label: theme === 'dark' ? t('profile_light_mode') : t('profile_dark_mode'),
          action: handleThemeToggle,
          isThemeToggle: true,
        },
      ],
    },
    {
      title: t('profile_section_support'),
      items: [
        { icon: 'message-circle', label: t('profile_support'), route: '/chat/support' },
        { icon: 'file-text', label: t('profile_my_tickets'), route: '/profile/tickets' },
        { icon: 'shield', label: t('profile_safety'), route: '/profile/safety' },
        { icon: 'book-open', label: t('profile_faqs'), route: '/profile/faqs' },
        { icon: 'edit-3', label: t('profile_blog'), route: '/blog' },
      ],
    },
    {
      title: '',
      items: [
        { icon: 'log-out', label: t('profile_logout'), action: handleLogout, color: c.destructive },
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
        {/* Logo mark + theme toggle row — real brand asset, consistent small size with Home header */}
        <View style={styles.headerTopRow}>
          <LogoImage variant="white" height={30} />
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
              <Text style={[styles.roleSwitchText, activeRole === 'CLIENT' && { color: c.primary }]}>{t('profile_client')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.roleSwitchOption, activeRole === 'PROVIDER' && styles.roleSwitchActive]}
              onPress={() => activeRole !== 'PROVIDER' && toggleRole()}
            >
              <Text style={[styles.roleSwitchText, activeRole === 'PROVIDER' && { color: c.primary }]}>{t('profile_pilot')}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.avatarWrap}>
          <View style={[styles.avatar, { backgroundColor: 'rgba(255,255,255,0.2)', borderColor: 'rgba(255,255,255,0.4)' }]}>
            {profilePicture ? (
              <Image source={{ uri: profilePicture }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>{firstName.charAt(0).toUpperCase()}</Text>
            )}
          </View>
          <TouchableOpacity
            style={[styles.editAvatarBtn, { backgroundColor: c.primary, borderColor: '#FFF', opacity: uploading || deleting ? 0.6 : 1 }]}
            onPress={handleAvatarAction}
            disabled={uploading || deleting}
            accessibilityLabel={t('pp_change_photo')}
          >
            {uploading || deleting ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <Feather name="camera" size={14} color="#FFF" />
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.email}>{email}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>{activeRole === 'CLIENT' ? t('profile_client') : t('profile_pilot')}</Text>
        </View>
      </View>

      {/* Stats Row — live client activity stats from GET /api/v1/clients/profile
          while the CLIENT role is active (loading spinner instead of fake
          zeros; retry banner on error). The provider role keeps the mock
          fallback until a provider-stats endpoint is wired. */}
      <Animated.View entering={FadeInDown.delay(80).duration(400)}>
        <View style={[styles.statsRow, { backgroundColor: c.card, shadowColor: '#000' }]}>
          {activeRole === 'CLIENT' && clientStats.status === 'error' && (
            <TouchableOpacity style={styles.statsErrorBar} onPress={clientStats.refresh}>
              <Text style={[styles.statsErrorText, { color: c.destructive }]}>
                {t(clientStats.errorMessage ?? 'cstat_err_network')}
              </Text>
              <Text style={[styles.statsRetryText, { color: c.primary }]}>{t('cstat_retry')}</Text>
            </TouchableOpacity>
          )}
          {[
            activeRole === 'CLIENT' && clientStats.status === 'loading'
              ? { label: t('profile_stat_jobs_done'), loading: true }
              : activeRole === 'CLIENT'
                ? {
                    label: t('profile_stat_jobs_done'),
                    value: clientStats.profile?.total_completed_jobs ?? CURRENT_USER.jobsDone,
                  }
                : { label: t('profile_stat_jobs_done'), value: CURRENT_USER.jobsDone },
            activeRole === 'CLIENT' && clientStats.status === 'loading'
              ? { label: t('profile_stat_active_jobs'), loading: true }
              : activeRole === 'CLIENT'
                ? {
                    label: t('profile_stat_active_jobs'),
                    value: clientStats.profile?.total_active_jobs ?? CURRENT_USER.activeJobs,
                  }
                : { label: t('profile_stat_active_jobs'), value: CURRENT_USER.activeJobs },
            activeRole === 'CLIENT' && clientStats.status === 'loading'
              ? { label: t('cstat_spent'), loading: true }
              : activeRole === 'CLIENT'
                ? {
                    label: t('cstat_spent'),
                    value: formatAmountSpent(clientStats.profile?.total_amount_spent),
                  }
                : { label: t('profile_stat_credit_pts'), value: CURRENT_USER.creditPoints },
          ].map((stat, i) => (
            <View key={i} style={[styles.statItem, i < 2 && { borderRightWidth: 1, borderRightColor: c.border }]}>
              {'loading' in stat && stat.loading ? (
                <ActivityIndicator size="small" color={c.primary} style={styles.statSpinner} />
              ) : (
                <Text style={[styles.statValue, { color: c.primary }]}>{stat.value}</Text>
              )}
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
  avatarImage: { width: '100%', height: '100%', borderRadius: 44 },
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
  statSpinner: { height: 24, marginBottom: 0 },
  statsErrorBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  statsErrorText: { fontFamily: 'Manrope_400Regular', fontSize: 11 },
  statsRetryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
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
