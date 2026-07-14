"use client";

import { useEffect, useRef } from "react";

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Leave",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onCancel(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  // Focus trap: keep Tab inside the dialog.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const dialog = e.currentTarget as HTMLElement;
    const focusable = dialog.querySelectorAll<HTMLElement>("button");
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };

  return (
    <div className="dialog-backdrop" onClick={onCancel} role="presentation">
      <div
        className="confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <h2>{title}</h2>
        <p>{message}</p>
        <div className="confirm-dialog-actions">
          <button ref={cancelRef} type="button" className="button button-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="button button-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
