/** Web version of confirm.ts: react-native-web's Alert.alert does nothing, so use the browser dialogs. */
export type ConfirmOptions = {
  title: string;
  message?: string;
  /** Label of the confirming button (unused: the browser dialog has fixed buttons). */
  confirmText?: string;
  /** Label of the cancel button (unused: the browser dialog has fixed buttons). */
  cancelText?: string;
  destructive?: boolean;
};

function text(title: string, message?: string) {
  return message ? `${title}\n\n${message}` : title;
}

/** Resolves true when the user confirms, false when they cancel. */
export function confirm({ title, message }: ConfirmOptions): Promise<boolean> {
  if (typeof window === 'undefined') return Promise.resolve(false);
  return Promise.resolve(window.confirm(text(title, message)));
}

/** Shows a message with a single OK button. */
export function showMessage(title: string, message?: string) {
  if (typeof window !== 'undefined') window.alert(text(title, message));
}
