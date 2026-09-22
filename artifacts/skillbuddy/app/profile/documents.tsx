import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/context/ThemeContext';
import { useLanguage, type TranslationKey } from '@/context/LanguageContext';
import { CURRENT_USER } from '@/data/mockData';
import BackButton from '@/components/BackButton';
import useResidencePermitUpload from '@/hooks/useResidencePermitUpload';
import useFaceVideoUpload from '@/hooks/useFaceVideoUpload';

type DocStatus = 'verified' | 'pending' | 'rejected';

const STATUS_META: Record<DocStatus, { labelKey: TranslationKey; icon: keyof typeof Feather.glyphMap }> = {
  verified: { labelKey: 'documents_verified', icon: 'check-circle' },
  pending: { labelKey: 'documents_pending', icon: 'clock' },
  rejected: { labelKey: 'documents_rejected', icon: 'alert-circle' },
};

/**
 * Residence-permit row: local status starts from mock data and switches to
 * "Pending Review" as soon as an upload succeeds (the API returns no status
 * field — upload = submitted for review). TODO: replace the mock seed with
 * the real verification-status endpoint when one exists.
 */
function ResidencePermitRow() {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const [status, setStatus] = useState<DocStatus>(CURRENT_USER.residencePermit);
  const [previews, setPreviews] = useState<{ front: string | null; back: string | null }>({ front: null, back: null });
  const { pickAndUpload, uploading } = useResidencePermitUpload((frontUrl, backUrl) => {
    setPreviews({ front: frontUrl, back: backUrl });
    setStatus('pending');
  });

  const meta = STATUS_META[status];
  const accent = status === 'verified' ? c.success : status === 'pending' ? c.warning : c.destructive;
  const accentLight = status === 'verified' ? c.successLight : status === 'pending' ? '#FFF6E8' : c.urgentLight;

  return (
    <View style={[styles.docCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[styles.docIcon, { backgroundColor: c.accent }]}>
        <Feather name="file-text" size={18} color={c.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.docTitle, { color: c.text }]}>{t('documents_residence')}</Text>
        <View style={[styles.statusChip, { backgroundColor: accentLight }]}>
          <Feather name={meta.icon} size={11} color={accent} />
          <Text style={[styles.statusText, { color: accent }]}>{t(meta.labelKey)}</Text>
        </View>
        {(previews.front || previews.back) ? (
          <Text style={[styles.previewNote, { color: c.mutedForeground }]}>
            {t('documents_rp_submitted_note')}
          </Text>
        ) : null}
      </View>
      <TouchableOpacity
        style={[styles.docAction, { borderColor: c.border, opacity: uploading ? 0.6 : 1 }]}
        onPress={pickAndUpload}
        disabled={uploading}
      >
        {uploading ? (
          <ActivityIndicator size="small" color={c.primary} />
        ) : (
          <Text style={[styles.docActionText, { color: c.text }]}>
            {status === 'verified' ? t('documents_view') : t('documents_reupload')}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

export default function DocumentsScreen() {
  const insets = useSafeAreaInsets();
  const { colors: c } = useTheme();
  const { t } = useLanguage();

  return (
    <View style={[styles.root, { backgroundColor: c.background, paddingTop: insets.top }]}>
      <View style={[styles.header, { backgroundColor: c.surface, borderBottomColor: c.border }]}>
        <BackButton />
        <Text style={[styles.headerTitle, { color: c.text }]}>{t('documents_title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: 20 }} showsVerticalScrollIndicator={false}>
        <Text style={[styles.hint, { color: c.mutedForeground }]}>
          {t('documents_hint')}
        </Text>
        <FaceVerificationRow />
        <ResidencePermitRow />
      </ScrollView>
    </View>
  );
}

/**
 * Face-verification row: LIVE front-camera video upload (POST /users/face-video).
 * Gallery upload deliberately not offered (liveness standard — flagged).
 * Status switches to Pending Review on successful upload; TODO: real
 * verification-status endpoint when one exists.
 */
function FaceVerificationRow() {
  const { colors: c } = useTheme();
  const { t } = useLanguage();
  const [status, setStatus] = useState<DocStatus>(CURRENT_USER.faceVerification);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const { recordAndUpload, uploading } = useFaceVideoUpload((url) => {
    setVideoUrl(url);
    setStatus('pending');
  });
  const meta = STATUS_META[status];
  const accent = status === 'verified' ? c.success : status === 'pending' ? c.warning : c.destructive;
  const accentLight = status === 'verified' ? c.successLight : status === 'pending' ? '#FFF6E8' : c.urgentLight;

  return (
    <View style={[styles.docCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={[styles.docIcon, { backgroundColor: c.accent }]}>
        <Feather name="video" size={18} color={c.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.docTitle, { color: c.text }]}>{t('documents_face')}</Text>
        <View style={[styles.statusChip, { backgroundColor: accentLight }]}>
          <Feather name={meta.icon} size={11} color={accent} />
          <Text style={[styles.statusText, { color: accent }]}>{t(meta.labelKey)}</Text>
        </View>
        {videoUrl ? (
          <Text style={[styles.previewNote, { color: c.mutedForeground }]}>
            {t('documents_fv_submitted_note')}
          </Text>
        ) : null}
      </View>
      <TouchableOpacity
        style={[styles.docAction, { borderColor: c.border, opacity: uploading ? 0.6 : 1 }]}
        onPress={recordAndUpload}
        disabled={uploading}
      >
        {uploading ? (
          <ActivityIndicator size="small" color={c.primary} />
        ) : (
          <Text style={[styles.docActionText, { color: c.text }]}>
            {status === 'verified' ? t('documents_view') : t('documents_fv_record')}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { paddingHorizontal: 20, paddingVertical: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1 },
  headerTitle: { fontFamily: 'Manrope_700Bold', fontSize: 18 },
  hint: { fontFamily: 'Manrope_400Regular', fontSize: 13, lineHeight: 19, marginBottom: 16 },
  docCard: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  docIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  docTitle: { fontFamily: 'Manrope_600SemiBold', fontSize: 14, marginBottom: 6 },
  statusChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontFamily: 'Manrope_600SemiBold', fontSize: 11 },
  previewNote: { fontFamily: 'Manrope_400Regular', fontSize: 11, marginTop: 6 },
  docAction: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, minWidth: 70, alignItems: 'center' },
  docActionText: { fontFamily: 'Manrope_500Medium', fontSize: 12 },
});
