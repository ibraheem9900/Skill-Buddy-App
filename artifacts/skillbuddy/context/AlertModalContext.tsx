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
  /**
   * Called ONCE whenever this dialog stops showing — button press, backdrop
   * tap, Android back or an external hideAlert. Every dismissal path funnels
   * through `close`, so a screen that paused live updates while the dialog was
   * open can resume from here without having to own the dialog's visibility.
   */
  onDismissed?: () => void;
}

interface AlertContextType {
  showAlert: (config: AppAlertConfig) => void;
  /**
   * Dismiss whatever is showing, WITHOUT a button press. A dialog is a promise
   * to the user ("confirm X"), and if the state it was about changes — e.g. a
   * bid is accepted while a withdraw confirmation is open — the promise is
   * stale and must not be kept silently.
   */
  hideAlert: () => void;
}

const AlertModalContext = createContext<AlertContextType>({
  showAlert: () => {},
  hideAlert: () => {},
});

export function AlertModalProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AppAlertConfig | null>(null);
  // Mirrored so `close` stays referentially stable while still being able to
  // notify the config that opened the dialog (see AppAlertConfig.onDismissed).
  const configRef = React.useRef<AppAlertConfig | null>(null);
  React.useEffect(() => {
    configRef.current = config;
  }, [config]);
  const { colors: c } = useTheme();

  const showAlert = useCallback((cfg: AppAlertConfig) => setConfig(cfg), []);
  const close = useCallback(() => {
    const dismissed = configRef.current;
    setConfig(null);
    dismissed?.onDismissed?.();
  }, []);

  const buttons: AppAlertButton[] = config?.buttons?.length ? config.buttons : [{ text: 'OK' }];

  const value = React.useMemo(() => ({ showAlert, hideAlert: close }), [showAlert, close]);

  return (
    <AlertModalContext.Provider value={value}>
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
                      <Text style={[styles.btnText, { color: isCancel ? c.text : isDestructive ? c.destructiveForeground : c.primaryForeground }]}>{btn.text}</Text>
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
}const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  card: { width: '100%', borderRadius: 20, padding: 24, alignItems: 'center', gap: 6 },
  iconWrap: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 17, textAlign: 'center' },
  message: { fontFamily: 'Manrope_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 19, marginBottom: 10 },
  buttonRow: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 6 },
  btn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 13, borderRadius: 12 },
  btnText: { fontFamily: 'Manrope_600SemiBold', fontSize: 14 },
});
