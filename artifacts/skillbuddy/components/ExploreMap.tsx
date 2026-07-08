// Web / fallback — react-native-maps is native-only.
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';

const c = colors.light;

export default function ExploreMap() {
  return (
    <View style={styles.root}>
      <Feather name="map" size={64} color={c.primary} />
      <Text style={styles.label}>Map view available on device</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, backgroundColor: '#E8F5F3', alignItems: 'center', justifyContent: 'center' },
  label: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#737373', marginTop: 12 },
});
