/**
 * Confirmation and message dialogs.
 * Native: Alert.alert. Web (confirm.web.ts): window.confirm / window.alert, because
 * react-native-web's Alert.alert is a no-op.
 */
import { Alert } from 'react-native';

export type ConfirmOptions = {
  title: string;
  message?: string;
  /** Label of the confirming button. Default "OK". */
  confirmText?: string;
  /** Label of the cancel button. Default "Cancel". */
  cancelText?: string;
  /** Style the confirming button as destructive (red on iOS). */
  destructive?: boolean;
};

/** Resolves true when the user confirms, false when they cancel. */
export function confirm({
  title,
  message,
  confirmText = 'OK',
  cancelText = 'Cancel',
  destructive,
}: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmText, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ]);
  });
}

/** Shows a message with a single OK button. */
export function showMessage(title: string, message?: string) {
  Alert.alert(title, message);
}
