"use client";

import { AlertTriangle, X } from "lucide-react";
import { useRef } from "react";
import { useFormStatus } from "react-dom";

import { logoutAction, logoutAllDevicesAction } from "./actions";
import styles from "./logout-button.module.css";

interface LogoutButtonProps {
  className?: string;
}

export function LogoutButton({ className }: LogoutButtonProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  return (
    <div className={styles.controls}>
      <form action={logoutAction}>
        <LogoutSubmitButton className={className}>Log out</LogoutSubmitButton>
      </form>
      <button
        className={`${styles.button} ${styles.allDevices}`}
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        Log out all devices
      </button>

      <dialog
        aria-labelledby="logout-all-title"
        aria-describedby="logout-all-description"
        className={styles.dialog}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            dialogRef.current?.close();
          }
        }}
        ref={dialogRef}
      >
        <div className={styles.dialogPanel}>
          <button
            aria-label="Close confirmation"
            className={styles.dialogClose}
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <X aria-hidden="true" size={19} />
          </button>
          <span className={styles.warningIcon} aria-hidden="true">
            <AlertTriangle size={22} />
          </span>
          <div className={styles.dialogCopy}>
            <h2 id="logout-all-title">Log out all devices?</h2>
            <p id="logout-all-description">
              This Director account will be signed out from every phone, computer, and browser.
              Other staff accounts will not be affected.
            </p>
          </div>
          <div className={styles.dialogActions}>
            <button
              className={styles.cancelButton}
              onClick={() => dialogRef.current?.close()}
              type="button"
            >
              Cancel
            </button>
            <form action={logoutAllDevicesAction}>
              <LogoutSubmitButton className={styles.confirmButton} pendingLabel="Closing sessions…">
                Log out all devices
              </LogoutSubmitButton>
            </form>
          </div>
        </div>
      </dialog>
    </div>
  );
}

function LogoutSubmitButton({
  children,
  className,
  pendingLabel = "Logging out…",
}: {
  children: React.ReactNode;
  className?: string | undefined;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      aria-busy={pending}
      className={[styles.button, className].filter(Boolean).join(" ")}
      disabled={pending}
      type="submit"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
