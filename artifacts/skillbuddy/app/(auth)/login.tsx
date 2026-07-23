import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Link, useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';

const c = colors.light;

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Error', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      await login(email.trim(), password);
      // AuthGate will redirect to (tabs) automatically
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? 'Login failed. Please check your credentials.';
      Alert.alert('Login Failed', typeof msg === 'string' ? msg : 'Invalid credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Logo area */}
        <Animated.View entering={FadeInDown.delay(0).duration(400)} style={styles.logoWrap}>
          <View style={[styles.logoCircle, { backgroundColor: c.primary }]}>
            <Feather name="zap" size={36} color="#FFF" />
          </View>
          <Text style={styles.appName}>SkillBuddy</Text>
          <Text style={styles.tagline}>Find the skills you need</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(100).duration(400)} style={styles.form}>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in to your account</Text>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Email</Text>
            <View style={styles.inputRow}>
              <Feather name="mail" size={18} color={c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="example@gmail.com"
                placeholderTextColor={c.mutedForeground}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          </View>

          <View style={styles.fieldWrap}>
            <Text style={styles.label}>Password</Text>
            <View style={styles.inputRow}>
              <Feather name="lock" size={18} color={c.mutedForeground} style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="••••••••••••"
                placeholderTextColor={c.mutedForeground}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
              />
              <Pressable onPress={() => setShowPassword(!showPassword)}>
                <Feather name={showPassword ? 'eye' : 'eye-off'} size={18} color={c.mutedForeground} />
              </Pressable>
            </View>
          </View>

          <TouchableOpacity style={styles.forgotWrap} onPress={() => router.push('/(auth)/forgot-password')}>
            <Text style={[styles.forgotText, { color: c.primary }]}>Forgot Password?</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: loading ? c.primaryDark : c.primary }]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <Text style={styles.btnText}>Sign In</Text>
            )}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.divLine} />
            <Text style={styles.divText}>Or sign in with</Text>
            <View style={styles.divLine} />
          </View>

          <View style={styles.socialRow}>
            {(['apple', 'google', 'facebook'] as const).map((s) => (
              <TouchableOpacity key={s} style={styles.socialBtn}>
                <Feather
                  name={s === 'apple' ? 'smartphone' : s === 'google' ? 'globe' : 'facebook'}
                  size={22}
                  color="#1A1A1A"
                />
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.signupRow}>
            <Text style={styles.signupText}>Don't have an account? </Text>
            <Link href="/(auth)/signup" asChild>
              <TouchableOpacity>
                <Text style={[styles.signupLink, { color: c.primary }]}>Sign Up</Text>
              </TouchableOpacity>
            </Link>
          </View>
        </Animated.View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, backgroundColor: '#FFF', paddingHorizontal: 24 },
  logoWrap: { alignItems: 'center', marginBottom: 32 },
  logoCircle: { width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  appName: { fontFamily: 'Manrope_700Bold', fontSize: 26, color: '#1A1A1A' },
  tagline: { fontFamily: 'Manrope_400Regular', fontSize: 13, color: '#737373', marginTop: 2 },
  form: { gap: 0 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 24, color: '#1A1A1A', marginBottom: 4 },
  subtitle: { fontFamily: 'Manrope_400Regular', fontSize: 14, color: '#737373', marginBottom: 24 },
  fieldWrap: { marginBottom: 16 },
  label: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: '#1A1A1A', marginBottom: 8 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#E8E8E8',
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1,
    fontFamily: 'Manrope_400Regular',
    fontSize: 14,
    color: '#1A1A1A',
  },
  forgotWrap: { alignSelf: 'flex-end', marginBottom: 20, marginTop: 4 },
  forgotText: { fontFamily: 'Manrope_500Medium', fontSize: 13 },
  btn: { borderRadius: 28, paddingVertical: 16, alignItems: 'center', marginBottom: 20 },
  btnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 16, color: '#FFF' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  divLine: { flex: 1, height: 1, backgroundColor: '#E8E8E8' },
  divText: { fontFamily: 'Manrope_400Regular', fontSize: 12, color: '#9E9E9E' },
  socialRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 28 },
  socialBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    borderColor: '#E8E8E8',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFF',
  },
  signupRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  signupText: { fontFamily: 'Manrope_400Regular', fontSize: 14, color: '#737373' },
  signupLink: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
});
