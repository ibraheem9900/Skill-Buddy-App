import React, { createContext, useCallback, useContext, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';

export interface AppAlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface AppAlertConfig {
  title: string;
  message?: string;
  icon?: keyof typeof Feather.glyphMap;
  buttons?: AppAlertButton[];
}

interface AlertContextType {
  showAlert: (config: AppAlertConfig) => void;
}

const AlertModalContext = createContext<AlertContextType>({ showAlert: () => {} });

export function AlertModalProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppAlertConfig | null>(null);
  const { colors: c } = useTheme();

  const showAlert = useCallback((cfg: AppAlertConfig) => setConfig(cfg), []);
  const close = useCallback(() => setConfig(null), []);

  const buttons: AppAlertButton[] = config?.buttons?.length ? config.buttons : [{ text: 'OK' }];

  return (
    <AlertModalContext.Provider value={{ showAlert }}>
      {children}
      <Modal visible={!!config} transparent animationType="none" onRequestClose={close}>
        <Animated.View entering={FadeIn.duration(180)} style={StyleSheet.absoluteFill}>
          <BlurView intensity={30} tint="dark" style={StyleSheet.absoluteFill} />
          <Pressable style={styles.backdrop} onPress={close} />
          <View style={styles.centerWrap} pointerEvents="box-none">
            <Animated.View
              entering={ZoomIn.duration(220).springify().damping(16)}
              style={[styles.card, { backgroundColor: c.card }]}
            >
              {config?.icon && (
                <View style={[styles.iconWrap, { backgroundColor: c.primaryLight }]}>
                  <Feather name={config.icon} size={24} color={c.primary} />
                </View>
              )}
              <Text style={[styles.title, { color: c.text }]}>{config?.title}</Text>
              {!!config?.message && (
                <Text style={[styles.message, { color: c.mutedForeground }]}>{config.message}</Text>
              )}
              <View style={styles.buttonRow}>
                {buttons.map((btn, i) => {
                  const isDestructive = btn.style === 'destructive';
                  const isCancel = btn.style === 'cancel';
                  return (
                    <TouchableOpacity
                      key={i}
                      style={[
                        styles.btn,
                        isCancel
                          ? { backgroundColor: c.muted }
                          : { backgroundColor: isDestructive ? c.destructive : c.primary },
                      ]}
                      onPress={() => {
                        close();
                        btn.onPress?.();
                      }}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.btnText, { color: isCancel ? c.text : '#FFF' }]}>{btn.text}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Animated.View>
          </View>
        </Animated.View>
      </Modal>
    </AlertModalContext.Provider>
  );
}

export function useAppAlert() {
  return useContext(AlertModalContext).showAlert;
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  card: { width: '100%', borderRadius: 20, padding: 24, alignItems: 'center', gap: 6 },
  iconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 17, textAlign: 'center' },
  message: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 10 },
  buttonRow: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 6 },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12 },
  btnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
});
