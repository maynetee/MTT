import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "../../i18n";
import { Button } from "./Button";
import { Modal } from "./Modal";

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** `danger` for destructive actions: red confirm button, focus starts on Cancel. */
  tone?: "danger" | "primary";
  /** When set, the confirm button stays disabled until this text is typed (e.g. a name). */
  confirmText?: string;
  /** Label of the field for `confirmText`. */
  confirmTextLabel?: string;
  /** May return a promise: the button shows progress until it settles. */
  onConfirm(): void | Promise<unknown>;
  onCancel(): void;
}

/** "Are you sure?" before an action that is hard to take back. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  tone = "primary",
  confirmText,
  confirmTextLabel,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const { t } = useI18n();
  const inputId = useId();
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setTyped("");
      setBusy(false);
    }
  }, [open]);

  const matches = confirmText === undefined || typed.trim() === confirmText.trim();

  const confirm = async () => {
    if (!matches || busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  const initialFocus = confirmText !== undefined ? inputRef : tone === "danger" ? cancelRef : confirmRef;

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={message}
      role="alertdialog"
      tone={tone === "danger" ? "danger" : "default"}
      initialFocus={initialFocus}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onCancel}>
            {cancelLabel ?? t("common.cancel")}
          </Button>
          <Button ref={confirmRef} variant={tone === "danger" ? "danger" : "primary"} onClick={() => void confirm()} disabled={!matches} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {confirmText !== undefined && (
        <form
          className="confirm-type"
          onSubmit={(event) => {
            event.preventDefault();
            void confirm();
          }}
        >
          <label className="field-label" htmlFor={inputId}>
            {confirmTextLabel ?? t("confirm.typeToConfirm", { text: confirmText })}
          </label>
          <input
            ref={inputRef}
            id={inputId}
            className="input"
            value={typed}
            autoComplete="off"
            spellCheck={false}
            onChange={(event) => setTyped(event.target.value)}
          />
        </form>
      )}
    </Modal>
  );
}
