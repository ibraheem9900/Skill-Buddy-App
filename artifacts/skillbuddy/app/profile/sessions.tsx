import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage } from '@/context/LanguageContext';
import { authApi } from '@/services/api';
import { useAuth } from '@/context/AuthContext';
import LogoImage from '@/components/LogoImage';

/** Session shape from GET /api/v1/auth/sessions (SessionResponse schema). */
interface Session {
  sid: string;
  device_type: string | null;
  device_name: string | null;
  browser: string | null;
  os_name: string | null;
  app_version: string | null;
  ip_address: string | null;
  last_active: string;
  created_at: string;
  is_current: boolean;
}

type LoadState = 'loading' | 'ready' | 'error';

/** Extract an ISO timestamp even if the backend sends a space instead of 'T'. */
function parseDate(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Locale-aware "time ago" — falls back to the absolute date for old entries. */
function timeAgo(date: Date, locale: string, t: (k: any, v?: any) => string): string {
  const diffMs = Date.now() - date.getTime();
  const future = diffMs < 0;
  const mins = Math.round(Math.abs(diffMs) / 60000);
  const localeTag = locale === 'de' ? 'de-DE' : locale === 'et' ? 'et-EE' : locale === 'lv' ? 'lv-LV' : locale === 'lt' ? 'lt-LT' : 'en-GB';
  const rtf = new Intl.RelativeTimeFormat(localeTag, { numeric: 'auto' });
  if (mins < 1) return future ? t('sess_just_now') : t('sess_just_now');
  if (mins < 60) return rtf.format(future ? mins : -mins, 'minute');
  const hours = Math.round(mins / 60);
  if (hours < 24) return rtf.format(future ? hours : -hours, 'hour');
  const days = Math.round(hours / 24);
  if (days < 30) return rtf.format(future ? days : -days, 'day');
  return date.toLocaleDateString(localeTag, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Active Sessions (Settings → Account) — GET /api/v1/auth/sessions.
 *
 * Bearer token is attached automatically by the shared axios instance.
 * Fetches on screen entry only (no polling); RefreshControl for manual
 * refresh. The current device (is_current) is visually distinguished with a
 * "This device" badge and a distinct border color.
 */
export default function SessionsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { t, language } = useLanguage();
  const { clearSession } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [state, setState] = useState<LoadState>('loading');
  const [refreshing, setRefreshing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [revokingSid, setRevokingSid] = useState<string | null>(null);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(
    async (isRefresh: boolean) => {
      if (isRefresh) setRefreshing(true);
      try {
        // GET /api/v1/auth/sessions — Bearer auto-attached by the shared
        // instance (with silent refresh on expiry). Called on screen entry
        // and pull-to-refresh only — no polling.
        const { data } = await authApi.getSessions();
        setSessions(Array.isArray(data?.sessions) ? data.sessions : []);
        setState('ready');
      } catch (err: any) {
        if (!isRefresh) setState('error');
        // On pull-to-refresh failure keep showing the previous list.
      } finally {
        setRefreshing(false);
      }
    },
    []
  );

  // Fetch on every screen entry (also covers returning here after a password
  // change, which invalidates sessions and changes the list).
  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load])
  );

  const otherCount = sessions.filter((s) => !s.is_current).length;

  /** DELETE /api/v1/auth/sessions — revokes all sessions except this device's. */
  const performRevoke = async () => {
    if (revoking) return;
    setRevoking(true);
    setActionError(null);
    try {
      // Bearer auto-attached by the shared instance (silent refresh on 401).
      const res = await authApi.revokeOtherSessions();
      // Optimistically keep only the current device, then re-sync from the
      // backend so the UI reflects the authoritative list.
      setSessions((prev) => prev.filter((s) => s.is_current));
      Alert.alert(
        t('sess_revoke_success_title'),
        typeof res?.data?.message === 'string' && res.data.message
          ? res.data.message
          : t('sess_revoke_success_msg')
      );
      load(true);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        // The axios layer already tried one refresh and, on failure, cleared
        // tokens + fired the session-expired handler. Send the user to Login.
        setActionError(t('sess_revoke_err_auth'));
        router.replace('/(auth)/login' as any);
      } else if (!err?.response) {
        setActionError(t('rp_err_network'));
      } else {
        setActionError(t('sess_revoke_err'));
      }
    } finally {
      setRevoking(false);
    }
  };

  /** Confirmation gate — this action is immediate and irreversible. */
  const confirmRevokeOthers = () => {
    if (revoking || otherCount === 0) return;
    Alert.alert(t('sess_revoke_confirm_title'), t('sess_revoke_confirm_msg'), [
      { text: t('action_cancel'), style: 'cancel' },
      { text: t('sess_revoke_confirm_btn'), style: 'destructive', onPress: performRevoke },
    ]);
  };

  /**
   * DELETE /api/v1/auth/sessions/{sid} — revokes ONE session.
   * The sid always comes from the loaded sessions list (never constructed).
   * Current-session revokes redirect to Login (tokens are dead); other-device
   * revokes just update the list.
   */
  const performRevokeOne = async (session: Session) => {
    if (revokingSid) return;
    setRevokingSid(session.sid);
    setActionError(null);
    try {
      // Bearer auto-attached by the shared instance (silent refresh on 401).
      const res = await authApi.revokeSession(session.sid);
      if (session.is_current) {
        // This device's session is gone — its tokens no longer work.
        await clearSession();
        Alert.alert(
          t('sess_one_bye_title'),
          typeof res?.data?.message === 'string' && res.data.message
            ? res.data.message
            : t('sess_one_bye_msg')
        );
        router.replace('/(auth)/login' as any);
      } else {
        // Remove the revoked entry, then re-sync from the backend.
        setSessions((prev) => prev.filter((s) => s.sid !== session.sid));
        Alert.alert(
          t('sess_one_done_title'),
          typeof res?.data?.message === 'string' && res.data.message
            ? res.data.message
            : t('sess_one_done_msg')
        );
        load(true);
      }
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        // Refresh already attempted and failed downstream; tokens cleared.
        setActionError(t('sess_revoke_err_auth'));
        router.replace('/(auth)/login' as any);
      } else if (status === 422) {
        // Invalid/unknown sid — it may already be revoked/expired. Surface
        // the error and refresh so the list reflects reality.
        setActionError(t('sess_one_err_sid'));
        load(true);
      } else if (!err?.response) {
        setActionError(t('rp_err_network'));
      } else {
        setActionError(t('sess_one_err'));
      }
    } finally {
      setRevokingSid(null);
    }
  };

  /** Confirmation gate for a single session — heavier warning when it's THIS device. */
  const confirmRevokeOne = (session: Session) => {
    if (revokingSid) return;
    Alert.alert(
      session.is_current ? t('sess_one_confirm_current_title') : t('sess_one_confirm_title'),
      session.is_current ? t('sess_one_confirm_current_msg') : t('sess_one_confirm_msg'),
      [
        { text: t('action_cancel'), style: 'cancel' },
        {
          text: session.is_current ? t('sess_one_confirm_current_btn') : t('sess_one_confirm_btn'),
          style: 'destructive',
          onPress: () => performRevokeOne(session),
        },
      ]
    );
  };

  /**
   * DELETE /api/v1/auth/logout-all — signs out EVERY device INCLUDING this
   * one. Local tokens are cleared only after a confirmed success (or a 401,
   * which means the session was already dead server-side). On network failure
   * nothing is cleared — the user stays logged in and can retry.
   */
  const performLogoutAll = async () => {
    if (loggingOutAll) return;
    setLoggingOutAll(true);
    setActionError(null);
    try {
      // Bearer auto-attached by the shared instance (silent refresh on 401).
      const res = await authApi.logoutAll();
      const msg =
        typeof res?.data?.message === 'string' && res.data.message
          ? res.data.message
          : t('sess_all_done_msg');
      // Session is gone server-side → wipe local state and go to Login.
      await clearSession();
      router.replace('/(auth)/login' as any);
      Alert.alert(t('sess_all_done_title'), msg);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        // Token invalid/expired even after refresh → already logged out
        // server-side. Clear local remnants and send to Login anyway.
        await clearSession();
        router.replace('/(auth)/login' as any);
      } else if (!err?.response) {
        // Request never reached the server → the logout did NOT happen.
        // Keep the user signed in locally; offer retry.
        setActionError(t('rp_err_network'));
      } else {
        setActionError(t('sess_all_err'));
      }
    } finally {
      setLoggingOutAll(false);
    }
  };

  /** Confirmation gate — wording deliberately stronger than "log out others". */
  const confirmLogoutAll = () => {
    if (loggingOutAll) return;
    Alert.alert(t('sess_all_confirm_title'), t('sess_all_confirm_msg'), [
      { text: t('action_cancel'), style: 'cancel' },
      { text: t('sess_all_confirm_btn'), style: 'destructive', onPress: performLogoutAll },
    ]);
  };

  const renderItem = ({ item, index }: { item: Session; index: number }) => {
    const lastActive = parseDate(item.last_active);
    const created = parseDate(item.created_at);
    const title =
      item.device_name?.trim() ||
      [item.os_name, item.device_type].filter(Boolean).join(' ') ||
      t('sess_unknown_device');
    const metaParts = [
      item.browser?.trim() || null,
      item.os_name?.trim() || null,
      item.app_version?.trim() ? `v${item.app_version.trim()}` : null,
      item.ip_address?.trim() || null,
    ].filter(Boolean);

    return (
      <Animated.View entering={FadeInDown.delay(index * 60).duration(300)}>
        <View
          style={[
            styles.card,
            {
              backgroundColor: c.card,
              borderColor: item.is_current ? c.primary : c.border,
              borderWidth: item.is_current ? 1.5 : 1,
            },
          ]}
        >
          <View style={styles.cardTop}>
            <View style={[styles.iconCircle, { backgroundColor: item.is_current ? c.primaryLight : c.surface }]}>
              <Feather
                name={item.is_current ? 'smartphone' : item.device_type === 'tablet' ? 'tablet' : 'monitor'}
                size={20}
                color={item.is_current ? c.primary : c.mutedForeground}
              />
            </View>
            <View style={styles.titleWrap}>
              <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
                {title}
              </Text>
              {!!metaParts.length && (
                <Text style={[styles.meta, { color: c.mutedForeground }]} numberOfLines={1}>
                  {metaParts.join(' · ')}
                </Text>
              )}
            </View>
            {item.is_current && (
              <View style={[styles.badge, { backgroundColor: c.primaryLight }]}>
                <Text style={[styles.badgeText, { color: c.primary }]}>{t('sess_this_device')}</Text>
              </View>
            )}
          </View>
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <View style={styles.timeRow}>
            <Feather name="clock" size={14} color={c.mutedForeground} />
            <Text style={[styles.timeText, { color: c.mutedForeground }]}>
              {t('sess_last_active', {
                time: lastActive ? timeAgo(lastActive, language, t) : t('sess_unknown_time'),
              })}
            </Text>
          </View>
          <View style={styles.timeRow}>
            <Feather name="calendar" size={14} color={c.mutedForeground} />
            <Text style={[styles.timeText, { color: c.mutedForeground }]}>
              {t('sess_signed_in', {
                time: created ? timeAgo(created, language, t) : t('sess_unknown_time'),
              })}
            </Text>
          </View>
          {/* Per-session logout — destructive, confirmation-gated, per-device
              spinner while its DELETE is in flight. */}
          <TouchableOpacity
            style={[styles.sessionLogoutBtn, { borderColor: c.border }, revokingSid === item.sid && { opacity: 0.6 }]
            }
            onPress={() => confirmRevokeOne(item)}
            disabled={!!revokingSid}
            activeOpacity={0.8}
          >
            {revokingSid === item.sid ? (
              <ActivityIndicator size="small" color={c.destructive} />
            ) : (
              <>
                <Feather name="log-out" size={14} color={c.destructive} />
                <Text style={[styles.sessionLogoutText, { color: c.destructive }]}>
                  {item.is_current ? t('sess_one_btn_current') : t('sess_one_btn')}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    );
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color={c.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('sess_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      {state === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.primary} />
        </View>
      ) : state === 'error' ? (
        <View style={styles.center}>
          <Feather name="wifi-off" size={40} color={c.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: c.text }]}>{t('sess_error_title')}</Text>
          <Text style={[styles.emptySub, { color: c.mutedForeground }]}>{t('sess_error_sub')}</Text>
          <TouchableOpacity style={[styles.retryBtn, { backgroundColor: c.primary }]} onPress={() => load(false)}>
            <Text style={styles.retryText}>{t('error_retry')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.sid}
          renderItem={renderItem}
          contentContainerStyle={[styles.list, sessions.length === 0 && styles.listEmpty]}
          ListHeaderComponent={
            <Animated.View entering={FadeInDown.duration(350)}>
              <LogoImage variant={c.background === '#0A0D0D' ? 'light' : 'green'} height={36} animateOnMount={false} />
              <Text style={[styles.screenTitle, { color: c.text }]}>{t('sess_screen_title')}</Text>
              <Text style={[styles.screenSub, { color: c.mutedForeground }]}>{t('sess_screen_sub')}</Text>
            </Animated.View>
          }
          ListEmptyComponent={
            <View style={styles.center}>
              <Feather name="inbox" size={40} color={c.mutedForeground} />
              <Text style={[styles.emptyTitle, { color: c.text }]}>{t('sess_empty_title')}</Text>
              <Text style={[styles.emptySub, { color: c.mutedForeground }]}>{t('sess_empty_sub')}</Text>
            </View>
          }
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load(true)} tintColor={c.primary} colors={[c.primary]} />
          }
          ListFooterComponent={
            <Animated.View entering={FadeInDown.delay(150).duration(300)}>
              {/* Logout all other devices — destructive, confirmation-gated.
                  Hidden when there are no other sessions. */}
              {otherCount > 0 && (
                <>
                  {!!actionError && (
                    <View style={[styles.actionErrorBox, { backgroundColor: c.card, borderColor: c.destructive }]}>
                      <Feather name="alert-circle" size={15} color={c.destructive} />
                      <Text style={[styles.actionErrorText, { color: c.destructive }]}>{actionError}</Text>
                    </View>
                  )}
                  <TouchableOpacity
                    style={[
                      styles.revokeBtn,
                      {
                        backgroundColor: c.card,
                        borderColor: revoking ? c.border : c.destructive,
                        opacity: revoking ? 0.6 : 1,
                      },
                    ]}
                    onPress={confirmRevokeOthers}
                    disabled={revoking || loggingOutAll}
                    activeOpacity={0.8}
                  >
                    {revoking ? (
                      <ActivityIndicator size="small" color={c.destructive} />
                    ) : (
                      <>
                        <Feather name="log-out" size={17} color={c.destructive} />
                        <Text style={[styles.revokeBtnText, { color: c.destructive }]}>
                          {t('sess_revoke_btn', { n: otherCount })}
                        </Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
              {/* Logout EVERYWHERE — solid destructive fill to signal this
                  is the most severe option: signs out THIS device too.
                  Always available, regardless of how many other devices exist. */}
              <TouchableOpacity
                style={[
                  styles.logoutAllBtn,
                  { backgroundColor: c.destructive, opacity: loggingOutAll ? 0.6 : 1 },
                ]}
                onPress={confirmLogoutAll}
                disabled={loggingOutAll || revoking}
                activeOpacity={0.8}
              >
                {loggingOutAll ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Feather name="alert-triangle" size={17} color="#FFF" />
                    <Text style={styles.logoutAllBtnText}>{t('sess_all_btn')}</Text>
                  </>
                )}
              </TouchableOpacity>
            </Animated.View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    paddingHorizontal: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
  },
  backBtn: { width: 40, alignItems: 'flex-start' },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  list: { padding: 20, paddingBottom: 40 },
  listEmpty: { flexGrow: 1, justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  screenTitle: { fontFamily: 'Manrope_700Bold', fontSize: 22, textAlign: 'center', marginTop: 16 },
  screenSub: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 20 },
  card: { borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconCircle: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  titleWrap: { flex: 1, gap: 2 },
  title: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  meta: { fontFamily: 'Manrope_400Regular', fontSize: 12 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  divider: { height: 1, marginVertical: 12 },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  timeText: { fontFamily: 'Manrope_400Regular', fontSize: 12, flex: 1 },
  emptyTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 16 },
  emptySub: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  retryBtn: { borderRadius: 24, paddingHorizontal: 24, paddingVertical: 10, marginTop: 6 },
  retryText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, color: '#FFF' },
  actionErrorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  actionErrorText: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 18 },
  revokeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: 28,
    paddingVertical: 14,
    marginTop: 16,
  },
  revokeBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  sessionLogoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 20,
    paddingVertical: 8,
    marginTop: 12,
  },
  sessionLogoutText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13 },
  logoutAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 28,
    paddingVertical: 14,
    marginTop: 12,
  },
  logoutAllBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15, color: '#FFF' },
});
