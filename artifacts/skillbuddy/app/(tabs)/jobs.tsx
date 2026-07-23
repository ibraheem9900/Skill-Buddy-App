import React, { useMemo, useState } from 'react';
import { FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useTheme } from '@/context/ThemeContext';
import { useRole } from '@/context/RoleContext';
import { CURRENT_USER, MOCK_JOBS, MOCK_BIDS } from '@/data/mockData';
import JobCard from '@/components/JobCard';
import EmptyState from '@/components/EmptyState';
import type { Job } from '@/types';

type ProviderFilter = 'available' | 'myBids' | 'active';

export default function JobsScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const { activeRole, toggleRole } = useRole();
  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;
  const [providerFilter, setProviderFilter] = useState<ProviderFilter>('available');

  const myJobs = useMemo(
    () => MOCK_JOBS.filter((j) => j.clientId === CURRENT_USER.id).sort((a, b) => b.biddingEndsAt - a.biddingEndsAt),
    []
  );

  const myBidJobIds = useMemo(() => new Set(MOCK_BIDS.map((b) => b.jobId)), []);

  const providerJobs = useMemo(() => {
    if (providerFilter === 'available') return MOCK_JOBS.filter((j) => j.status === 'bidding');
    if (providerFilter === 'myBids') return MOCK_JOBS.filter((j) => myBidJobIds.has(j.id));
    return MOCK_JOBS.filter((j) => j.status === 'assigned' || j.status === 'in_progress');
  }, [providerFilter, myBidJobIds]);

  const data: Job[] = activeRole === 'CLIENT' ? myJobs : providerJobs;

  const openJob = (job: Job) => {
    if (activeRole === 'CLIENT') {
      router.push(`/job/${job.id}` as any);
    } else {
      router.push(`/job/${job.id}/bid` as any);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <View>
          <Text style={[styles.title, { color: c.text }]}>Jobs</Text>
          <Text style={[styles.roleSub, { color: c.mutedForeground }]}>
            {activeRole === 'CLIENT' ? 'Client view' : 'SkillBuddy Pilot view'}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={[styles.roleToggle, { backgroundColor: c.muted }]}
            onPress={toggleRole}
          >
            <Feather name="repeat" size={14} color={c.text} />
            <Text style={[styles.roleToggleText, { color: c.text }]}>
              {activeRole === 'CLIENT' ? 'Switch to Pilot' : 'Switch to Client'}
            </Text>
          </TouchableOpacity>
          {activeRole === 'CLIENT' && (
            <TouchableOpacity
              style={[styles.postBtn, { backgroundColor: c.primary }]}
              onPress={() => router.push('/job/post' as any)}
            >
              <Feather name="plus" size={16} color="#FFF" />
              <Text style={styles.postBtnText}>Post a Job</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {activeRole === 'PROVIDER' && (
        <View style={[styles.filterRow, { borderBottomColor: c.border }]}>
          {(['available', 'myBids', 'active'] as ProviderFilter[]).map((f) => (
            <TouchableOpacity
              key={f}
              style={[
                styles.filterChip,
                { backgroundColor: providerFilter === f ? c.primary : c.muted },
              ]}
              onPress={() => setProviderFilter(f)}
            >
              <Text style={[styles.filterText, { color: providerFilter === f ? '#FFF' : c.mutedForeground }]}>
                {f === 'available' ? 'Available' : f === 'myBids' ? 'My Bids' : 'Active Jobs'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <FlatList
        data={data}
        keyExtractor={(j) => j.id}
        contentContainerStyle={{ padding: 20, paddingBottom: TAB_HEIGHT + insets.bottom + 20, flexGrow: 1 }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <EmptyState
            icon="briefcase"
            title={activeRole === 'CLIENT' ? 'No Jobs Posted Yet' : 'No Jobs Here Yet'}
            subtitle={
              activeRole === 'CLIENT'
                ? 'Post a job and get bids from verified SkillBuddy Pilots near you.'
                : 'Check back soon — new jobs matching your skills will appear here.'
            }
            actionLabel={activeRole === 'CLIENT' ? 'Post a Job' : undefined}
            onAction={activeRole === 'CLIENT' ? () => router.push('/job/post' as any) : undefined}
          />
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={FadeInDown.delay(index * 60).duration(350)}>
            <JobCard job={item} onPress={() => openJob(item)} />
          </Animated.View>
        )}
      />
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
  title: { fontFamily: 'Manrope_700Bold', fontSize: 22 },
  roleSub: { fontFamily: 'Manrope_400Regular', fontSize: 12, marginTop: 2 },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  roleToggle: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 8, borderRadius: 10 },
  roleToggleText: { fontFamily: 'Manrope_500Medium', fontSize: 11 },
  postBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 10 },
  postBtnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 12, color: '#FFF' },
  filterRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  filterText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
});
