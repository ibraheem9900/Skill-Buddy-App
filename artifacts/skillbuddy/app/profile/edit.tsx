import React, { useState } from 'react';
import { Alert, ActivityIndicator, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { authApi } from '@/services/api';
import BackButton from '@/components/BackButton';


export default function EditProfileScreen() {
  const { colors: c } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, refreshUser } = useAuth();

  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [phone, setPhone] = useState(user?.phone ?? '');
  const [loading, setLoading] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    try {
      await authApi.updateUser({ first_name: firstName, last_name: lastName, phone });
      await refreshUser();
      Alert.alert('Saved', 'Profile updated successfully.');
      router.back();
    } catch {
      Alert.alert('Error', 'Failed to update profile. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: c.surface, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <BackButton />
        <Text style={[styles.title, { color: c.text }]}>Edit Profile</Text>
        <TouchableOpacity onPress={handleSave} disabled={loading}>
          {loading ? <ActivityIndicator size="small" color={c.primary} /> : (
            <Text style={[styles.saveText, { color: c.primary }]}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, gap: 16 }} showsVerticalScrollIndicator={false}>
        <View style={[styles.avatarWrap, { backgroundColor: c.primaryLight }]}>
          <Text style={[styles.avatarText, { color: c.primary }]}>{firstName.charAt(0)}</Text>
          <TouchableOpacity style={[styles.cameraBtn, { backgroundColor: c.primary }]}>
            <Feather name="camera" size={14} color="#FFF" />
          </TouchableOpacity>
        </View>

        {[
          { label: 'First Name', value: firstName, set: setFirstName, icon: 'user' as const },
          { label: 'Last Name', value: lastName, set: setLastName, icon: 'user' as const },
          { label: 'Phone', value: phone, set: setPhone, icon: 'phone' as const, keyboardType: 'phone-pad' as const },
        ].map((f) => (
          <View key={f.label}>
            <Text style={[styles.label, { color: c.text }]}>{f.label}</Text>
            <View style={[styles.inputRow, { backgroundColor: c.muted, borderColor: c.border }]}>
              <Feather name={f.icon} size={18} color={c.mutedForeground} style={{ marginRight: 10 }} />
              <TextInput
                style={[styles.input, { color: c.text }]}
                value={f.value}
                onChangeText={f.set}
                placeholder={f.label}
                placeholderTextColor={c.mutedForeground}
                keyboardType={f.keyboardType}
                autoCapitalize={f.label === 'Phone' ? 'none' : 'words'}
              />
            </View>
          </View>
        ))}

        <View>
          <Text style={[styles.label, { color: c.text }]}>Email (read-only)</Text>
          <View style={[styles.inputRow, { backgroundColor: c.muted, borderColor: c.border }]}>
            <Feather name="mail" size={18} color={c.mutedForeground} style={{ marginRight: 10 }} />
            <Text style={[styles.readOnly, { color: c.mutedForeground }]}>{user?.email ?? ''}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#FFF' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, gap: 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  title: { flex: 1, fontFamily: 'Manrope_700Bold', fontSize: 18, color: '#1A1A1A' },
  saveText: { fontFamily: 'Manrope_600SemiBold', fontSize: 15 },
  avatarWrap: { width: 88, height: 88, borderRadius: 44, alignSelf: 'center', alignItems: 'center', justifyContent: 'center', marginBottom: 8, position: 'relative' },
  avatarText: { fontFamily: 'Manrope_700Bold', fontSize: 36 },
  cameraBtn: { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFF' },
  label: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: '#1A1A1A', marginBottom: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: '#E8E8E8',
  },
  input: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, color: '#1A1A1A' },
  readOnly: { flex: 1, fontFamily: 'Manrope_400Regular', fontSize: 14, color: '#9E9E9E' },
});
