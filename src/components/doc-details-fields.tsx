import { StyleSheet, Switch, View } from 'react-native';

import { Chip, Field, Row, Section } from '@/components/ui';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { knownSpecialty, SPECIALTIES } from '@/lib/search';

export type DetailsValue = { doctor: string; specialty: string; hospital: string };

const SUGGESTIONS = 8;

/** Specialties to offer for what has been typed so far: matching names or everyday words. */
function suggestions(typed: string) {
  const q = typed.trim().toLowerCase();
  const exact = knownSpecialty(q);
  if (exact) return [exact];
  if (!q) return SPECIALTIES.slice(0, SUGGESTIONS);
  return SPECIALTIES.filter(
    (s) => s.name.toLowerCase().includes(q) || s.aliases.some((a) => a.startsWith(q)),
  ).slice(0, SUGGESTIONS);
}

/** Doctor, specialty and hospital fields, shared by the add screen and the edit sheet. */
export function DocDetailsFields({
  value,
  onChange,
  editable = true,
}: {
  value: DetailsValue;
  onChange: (v: DetailsValue) => void;
  editable?: boolean;
}) {
  const theme = useTheme();
  const set = (patch: Partial<DetailsValue>) => onChange({ ...value, ...patch });
  const chips = suggestions(value.specialty);
  const separator = <View style={[styles.separator, { backgroundColor: theme.separator }]} />;

  return (
    <Section title="Details (optional)" footer="Helps you find this later. Search for a doctor, a specialty like skin or heart, or a hospital.">
      <Field
        label="Doctor"
        value={value.doctor}
        onChangeText={(doctor) => set({ doctor })}
        placeholder="e.g. Dr. Rao"
        maxLength={80}
        autoCapitalize="words"
        editable={editable}
      />
      {separator}
      <Field
        label="Specialty"
        value={value.specialty}
        onChangeText={(specialty) => set({ specialty })}
        placeholder="e.g. Dermatology"
        maxLength={60}
        autoCapitalize="words"
        editable={editable}
      />
      {chips.length > 0 && (
        <View style={styles.chips}>
          {chips.map((s) => {
            const selected = s.name.toLowerCase() === value.specialty.trim().toLowerCase();
            return (
              <Chip
                key={s.name}
                label={s.name}
                selected={selected}
                disabled={!editable}
                onPress={() => set({ specialty: selected ? '' : s.name })}
              />
            );
          })}
        </View>
      )}
      {separator}
      <Field
        label="Hospital, clinic or lab"
        value={value.hospital}
        onChangeText={(hospital) => set({ hospital })}
        placeholder="e.g. Apollo Clinic"
        maxLength={80}
        autoCapitalize="words"
        returnKeyType="done"
        editable={editable}
      />
    </Section>
  );
}

/** "Only me" switch, shared by the add screen and the edit sheet. */
export function PrivateSwitch({
  value,
  onChange,
  editable = true,
}: {
  value: boolean;
  onChange: (v: boolean) => void;
  editable?: boolean;
}) {
  const theme = useTheme();
  return (
    <Section
      title="Who can see this"
      footer={
        value
          ? "Only you. Family you share your records with won't see this document. Copies they already saved can't be taken back."
          : 'You and family you share your records with.'
      }>
      <Row
        title="Only me"
        icon="lock"
        last
        right={
          <Switch
            value={value}
            onValueChange={onChange}
            disabled={!editable}
            trackColor={{ true: theme.tint, false: theme.backgroundSelected }}
            thumbColor={theme.backgroundElement}
            ios_backgroundColor={theme.backgroundSelected}
            accessibilityLabel="Only me"
            accessibilityHint="Hides this document from family you share your records with"
          />
        }
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.three,
  },
});
