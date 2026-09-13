import { Alert } from './Alert.tsx';
import { Button } from './Button.tsx';
import { Dialog } from './Dialog.tsx';

export interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  /** Disables dismissal and both buttons while the confirmed request runs. */
  pending: boolean;
  error?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * A yes/no question in a modal: message, an optional error from the last
 * attempt, Cancel and the confirming action. Mounted only while open.
 * @rfc RFC-13 R5, R10
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  danger = false,
  pending,
  error,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Dialog open title={title} onClose={onClose} closeDisabled={pending}>
      <p className="text-body text-canopy-800">{message}</p>
      {error ? <Alert tone="error">{error}</Alert> : null}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={pending}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} pending={pending} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
