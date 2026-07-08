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

export default function SignupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signup } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSignup = async () => {
    if (!firstName || !email || !password) {
      Alert.alert('Error', 'Please fill in all required fields.');
      return;
    }
    if (!agreed) {
      Alert.alert('Error', 'Please agree to the Terms & Conditions.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Error', 'Password must be at least 8 characters.');
      return;
    }
    setLoading(true);
    try {
      await signup({
        email: email.trim(),
        password,
        confirm_password: password,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
      });
      router.push('/(auth)/verify-email');
    } catch (err: any) {
      const msg = err?.response?.data?.detail ?? 'Signup failed. Please try again.';
      Alert.alert('Sign Up Failed', typeof msg === 'string' ? msg : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        contentContainerStyle={[styles.container, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(400)}>
          <Text style={styles.title}>Create Account</Text>
          <Text style={styles.subtitle}>Fill your information below or register{'\n'}with your social account.</Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(80).duration(400)} style={styles.form}>
          {[
            { label: 'First Name', value: firstName, set: setFirstName, placeholder: 'Esther', icon: 'user' as const },
            { label: 'Last Name', value: lastName, set: setLastName, placeholder: 'Howard', icon: 'user' as const },
            { label: 'Email', value: email, set: setEmail, placeholder: 'example@gmail.com', icon: 'mail' as const },
          ].map((f) => (
            <View key={f.label} style={styles.fieldWrap}>
              <Text style={styles.label}>{f.label}</Text>
              <View style={styles.inputRow}>
                <Feather name={f.icon} size={18} color={c.mutedForeground} style={styles.inputIcon} />
                <TextInput
                  style={styles.input}
                  placeholder={f.placeholder}
                  placeholderTextColor={c.mutedForeground}
                  value={f.value}
                  onChangeText={f.set}
                  autoCapitalize={f.label.includes('Name') ? 'words' : 'none'}
                  keyboardType={f.label === 'Email' ? 'email-address' : 'default'}
                  autoCorrect={false}
                />
              </View>
            </View>
          ))}

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

          <TouchableOpacity style={styles.termsRow} onPress={() => setAgreed(!agreed)}>
            <View style={[styles.checkbox, agreed && { backgroundColor: c.primary, borderColor: c.primary }]}>
              {agreed && <Feather name="check" size={12} color="#FFF" />}
            </View>
            <Text style={styles.termsText}>
              Agree with{' '}
              <Text style={[styles.termsLink, { color: c.primary }]}>Terms & Condition</Text>
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.btn, { backgroundColor: loading ? c.primaryDark : c.primary }]}
            onPress={handleSignup}
            disabled={loading}
          >
            {loading ? <ActivityIndicator color="#FFF" /> : <Text style={styles.btnText}>Sign Up</Text>}
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.divLine} />
            <Text style={styles.divText}>Or sign up with</Text>
            <View style={styles.divLine} />
          </View>

          <View style={styles.socialRow}>
            {['smartphone', 'globe', 'facebook'].map((icon) => (
              <TouchableOpacity key={icon} style={styles.socialBtn}>
                <Feather name={icon as any} size={22} color="#1A1A1A" />
              </TouchableOpacity>
            ))}
          </View>

          <View style={styles.loginRow}>
            <Text style={styles.loginText}>Already have an account? </Text>
            <Link href="/(auth)/login" asChild>
              <TouchableOpacity>
                <Text style={[styles.loginLink, { color: c.primary }]}>Sign In</Text>
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
  title: { fontFamily: 'Inter_700Bold', fontSize: 26, color: '#1A1A1A', marginBottom: 6 },
  subtitle: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#737373', marginBottom: 28, lineHeight: 20 },
  form: { gap: 0 },
  fieldWrap: { marginBottom: 16 },
  label: { fontFamily: 'Inter_500Medium', fontSize: 13, color: '#1A1A1A', marginBottom: 8 },
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
  input: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 14, color: '#1A1A1A' },
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 22, marginTop: 4 },
  checkbox: {
    width: 20, height: 20, borderRadius: 6, borderWidth: 2,
    borderColor: '#E8E8E8', alignItems: 'center', justifyContent: 'center',
  },
  termsText: { fontFamily: 'Inter_400Regular', fontSize: 13, color: '#1A1A1A' },
  termsLink: { fontFamily: 'Inter_500Medium' },
  btn: { borderRadius: 28, paddingVertical: 16, alignItems: 'center', marginBottom: 20 },
  btnText: { fontFamily: 'Inter_600SemiBold', fontSize: 16, color: '#FFF' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  divLine: { flex: 1, height: 1, backgroundColor: '#E8E8E8' },
  divText: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#9E9E9E' },
  socialRow: { flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 28 },
  socialBtn: {
    width: 52, height: 52, borderRadius: 26, borderWidth: 1.5,
    borderColor: '#E8E8E8', alignItems: 'center', justifyContent: 'center',
  },
  loginRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  loginText: { fontFamily: 'Inter_400Regular', fontSize: 14, color: '#737373' },
  loginLink: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
