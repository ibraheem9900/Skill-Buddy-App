import React, { useState } from 'react';
import { Alert, ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import colors from '@/constants/colors';
import { authApi } from '@/services/api';

const c = colors.light;

export default function ForgotPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSend = async () => {
    if (!email.trim()) { Alert.alert('Error', 'Please enter your email address.'); return; }
    setLoading(true);
    try {
      await authApi.forgotPassword(email.trim());
      setSent(true);
    } catch {
      Alert.alert('Error', 'Could not send reset email. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 24 }]}>
      <TouchableOpacity style={styles.back} onPress={() => router.back()}>
        <Feather name="arrow-left" size={22} color="#1A1A1A" />
      </TouchableOpacity>
      {sent ? (
        <View style={styles.center}>
          <View style={[styles.iconCircle, { backgroundColor: c.primaryLight }]}>
            <Feather name="check-circle" size={48} color={c.primary} />
          </View>
          <Text style={styles.title}>Check Your Email</Text>
          <Text style={styles.subtitle}>We've sent a password reset link to{'\n'}{email}</Text>
          <TouchableOpacity style={[styles.btn, { backgroundColor: c.primary }]} onPress={() => router.replace('/(auth)/login')}>
            <Text style={styles.btnText}>Back to Login</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.content}>
          <View style={[styles.iconCircle, { backgroundColor: c.primaryLight }]}>
            <Feather name="lock" size={40} color={c.primary} />
          </View>
          <Text style={styles.title}>Forgot Password?</Text>
          <Text style={styles.subtitle}>Don't worry! Enter your email address and we'll send you a link to reset your password.</Text>
          <Text style={styles.label}>Email Address</Text>
          <View style={styles.inputRow}>
            <Feather name="mail" size={18} color={c.mutedForeground} style={{ marginRight: 10 }} />
            <TextInput
              style={styles.input}
              placeholder="example@gmail.com"
              placeholderTextColor={c.mutedForeground}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
          </View>
          <TouchableOpacity style={[styles.btn, { backgroundColor: loading ? c.primaryDark : c.primary }]} onPress={handleSend} disabled={loading}>
            {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>Send Reset Link</Text>}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFF', paddingHorizontal: 24 },
  back: { marginBottom: 24 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  content: { gap: 12 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 8, alignSelf: 'center' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 24, color: '#1A1A1A', textAlign: 'center' },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#737373', textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  label: { fontFamily: 'Inter_500Medium', fontSize: 13, color: '#1A1A1A', marginTop: 8 },
  inputRow: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5',
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: '#E8E8E8',
  },
  input: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: '#1A1A1A' },
  btn: { borderRadius: 28, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  btnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#FFF' },
});
