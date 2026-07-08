import React from 'react';
import MapView, { Marker } from 'react-native-maps';
import { StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import colors from '@/constants/colors';
import { SERVICES } from '@/data/mockData';

const c = colors.light;

const SERVICE_COORDS = [
  { id: 's1', lat: 59.437, lng: 24.7536 },  // Tallinn
  { id: 's2', lat: 56.946, lng: 24.1059 },  // Riga
  { id: 's3', lat: 54.6872, lng: 25.2797 }, // Vilnius
  { id: 's5', lat: 58.3776, lng: 26.7290 }, // Tartu
];

export default function ExploreMap() {
  const router = useRouter();
  return (
    <MapView
      style={StyleSheet.absoluteFillObject}
      initialRegion={{ latitude: 57.5, longitude: 24.8, latitudeDelta: 6, longitudeDelta: 6 }}
    >
      {SERVICE_COORDS.map((coord) => {
        const svc = SERVICES.find((s) => s.id === coord.id);
        if (!svc) return null;
        return (
          <Marker
            key={coord.id}
            coordinate={{ latitude: coord.lat, longitude: coord.lng }}
            title={svc.title}
            description={`$${svc.price}`}
            pinColor={c.primary}
            onPress={() => router.push(`/service/${svc.id}` as any)}
          />
        );
      })}
    </MapView>
  );
}
