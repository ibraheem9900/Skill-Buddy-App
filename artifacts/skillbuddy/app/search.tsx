import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import BackButton from '@/components/BackButton';
import { useTheme } from '@/context/ThemeContext';
import { SERVICES, CATEGORIES, SUBSERVICES } from '@/data/mockData';
import { getServiceForSubservice } from '@/lib/serviceLookup';
import ServiceCard from '@/components/ServiceCard';

// ─── Suggestion types ────────────────────────────────────────────────────────
type SuggestionKind = 'service' | 'category' | 'subservice';
interface Suggestion {
  id: string;
  label: string;
  sublabel?: string;
  kind: SuggestionKind;
}

function buildSuggestions(q: string): Suggestion[] {
  if (!q.trim()) return [];
  const lq = q.toLowerCase();
  const results: Suggestion[] = [];

  CATEGORIES.forEach((c) => {
    if (c.name.toLowerCase().includes(lq)) {
      results.push({ id: `cat_${c.id}`, label: c.name, sublabel: 'Category', kind: 'category' });
    }
  });

  SUBSERVICES.forEach((ss) => {
    if (ss.name.toLowerCase().includes(lq) || ss.description.toLowerCase().includes(lq)) {
      results.push({ id: `ss_${ss.id}`, label: ss.name, sublabel: ss.description, kind: 'subservice' });
    }
  });

  SERVICES.forEach((s) => {
    if (
      s.title.toLowerCase().includes(lq) ||
      s.category.toLowerCase().includes(lq) ||
      s.provider.name.toLowerCase().includes(lq)
    ) {
      results.push({ id: `svc_${s.id}`, label: s.title, sublabel: s.category, kind: 'service' });
    }
  });

  return results.slice(0, 8);
}

const kindIcon: Record<SuggestionKind, string> = {
  service: 'briefcase',
  category: 'grid',
  subservice: 'list',
};

export default function SearchScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { colors: c } = useTheme();
  const inputRef = useRef<TextInput>(null);

  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const TAB_HEIGHT = Platform.OS === 'web' ? 84 : 60;

  // Live filtering results
  const filtered = SERVICES.filter(
    (s) =>
      !query ||
      s.title.toLowerCase().includes(query.toLowerCase()) ||
      s.category.toLowerCase().includes(query.toLowerCase()) ||
      s.provider.name.toLowerCase().includes(query.toLowerCase())
  );

  // Update suggestions on every keystroke
  useEffect(() => {
    if (!submitted && query.length > 0) {
      setSuggestions(buildSuggestions(query));
    } else {
      setSuggestions([]);
    }
  }, [query, submitted]);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  const handleQueryChange = (text: string) => {
    setQuery(text);
    if (submitted) setSubmitted(false);
  };

  const handleSubmit = () => {
    setSubmitted(true);
    setSuggestions([]);
    Keyboard.dismiss();
  };

  const handleSuggestionTap = (s: Suggestion) => {
    setSubmitted(true);
    setSuggestions([]);
    Keyboard.dismiss();
    if (s.kind === 'category') {
      const catId = s.id.replace('cat_', '');
      router.push(`/category/${catId}` as any);
    } else if (s.kind === 'subservice') {
      const ssId = s.id.replace('ss_', '');
      const svc = getServiceForSubservice(ssId);
      router.push(`/service/${svc.id}` as any);
    } else {
      const svcId = s.id.replace('svc_', '');
      router.push(`/service/${svcId}` as any);
    }
  };

  const showSuggestions = suggestions.length > 0 && !submitted;
  const showResults = submitted || (query.length > 0 && !showSuggestions);

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      {/* Search Header */}
      <View style={[styles.searchHeader, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <View style={[styles.searchBar, { backgroundColor: c.input }]}>
          <Feather name="search" size={18} color={c.primary} />
          <TextInput
            ref={inputRef}
            style={[styles.searchInput, { color: c.text }]}
            value={query}
            onChangeText={handleQueryChange}
            onSubmitEditing={handleSubmit}
            placeholder="Search services, categories…"
            placeholderTextColor={c.mutedForeground}
            returnKeyType="search"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(''); setSubmitted(false); }}>
              <View style={[styles.clearBtn, { backgroundColor: c.primaryLight }]}>
                <Feather name="x" size={14} color={c.primary} />
              </View>
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity onPress={() => router.push('/filter')}>
          <Feather name="sliders" size={20} color={c.text} />
        </TouchableOpacity>
      </View>

      {/* Auto-suggest dropdown */}
      {showSuggestions && (
        <View style={[styles.suggestBox, { backgroundColor: c.card, borderColor: c.border }]}>
          {suggestions.map((s, i) => (
            <TouchableOpacity
              key={s.id}
              style={[styles.suggestRow, i < suggestions.length - 1 && { borderBottomColor: c.border, borderBottomWidth: 1 }]}
              onPress={() => handleSuggestionTap(s)}
              activeOpacity={0.75}
            >
              <View style={[styles.suggestIcon, { backgroundColor: c.primaryLight }]}>
                <Feather name={kindIcon[s.kind] as any} size={14} color={c.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.suggestLabel, { color: c.text }]} numberOfLines={1}>{s.label}</Text>
                {s.sublabel && (
                  <Text style={[styles.suggestSub, { color: c.mutedForeground }]} numberOfLines={1}>{s.sublabel}</Text>
                )}
              </View>
              <Feather name="arrow-up-left" size={14} color={c.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Results count */}
      {showResults && (
        <View style={[styles.resultRow, { borderBottomColor: c.border }]}>
          <Text style={[styles.resultCount, { color: c.mutedForeground }]}>
            {filtered.length} result{filtered.length !== 1 ? 's' : ''} for{' '}
            <Text style={{ color: c.text, fontFamily: 'Inter_600SemiBold' }}>"{query}"</Text>
          </Text>
        </View>
      )}

      {/* No results empty state */}
      {showResults && filtered.length === 0 && (
        <View style={styles.emptyWrap}>
          <View style={[styles.emptyIconWrap, { backgroundColor: c.primaryLight }]}>
            <Feather name="search" size={36} color={c.primary} />
          </View>
          <Text style={[styles.emptyTitle, { color: c.text }]}>No Results</Text>
          <Text style={[styles.emptySub, { color: c.mutedForeground }]}>
            No services match "{query}". Try a different term or request a custom quote.
          </Text>
          <TouchableOpacity
            style={[styles.emptyBtn, { backgroundColor: c.primary }]}
            onPress={() => router.push('/quote-request' as any)}
          >
            <Text style={styles.emptyBtnText}>Get a Custom Quote</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.emptyBtnOutline, { borderColor: c.primary }]}
            onPress={() => router.push('/(tabs)/inbox' as any)}
          >
            <Feather name="message-circle" size={16} color={c.primary} />
            <Text style={[styles.emptyBtnOutlineText, { color: c.primary }]}>Start Live Chat</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Results list */}
      {showResults && filtered.length > 0 && (
        <FlatList
          data={filtered}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: 16, paddingBottom: TAB_HEIGHT + insets.bottom + 16 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item, index }) => (
            <Animated.View entering={FadeInDown.delay(index * 50).duration(300)}>
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
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: 1,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14 },
  clearBtn: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  suggestBox: {
    marginHorizontal: 16,
    marginTop: 4,
    borderRadius: 14,
    borderWidth: 1,
    overflow: 'hidden',
    zIndex: 10,
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    gap: 10,
  },
  suggestIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestLabel: { fontFamily: 'Inter_500Medium', fontSize: 14 },
  suggestSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 1 },
  resultRow: { paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1 },
  resultCount: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  emptyWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyIconWrap: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 18, textAlign: 'center' },
  emptySub: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { marginTop: 4, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 28 },
  emptyBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 15, color: '#FFF' },
  emptyBtnOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 28,
    borderWidth: 1.5,
  },
  emptyBtnOutlineText: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
});
