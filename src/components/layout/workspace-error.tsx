"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";

import styles from "./workspace-state.module.css";

interface WorkspaceErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export function WorkspaceError({ error, reset }: WorkspaceErrorProps) {
  useEffect(() => {
    console.error("[workspace]", {
      digest: error.digest,
      name: error.name,
    });
  }, [error]);

  return (
    <div className={styles.error} role="alert">
      <AlertTriangle aria-hidden="true" size={30} />
      <h1>We could not open this workspace</h1>
      <p>Your data was not changed. Check your connection and try again.</p>
      <button onClick={reset} type="button">
        <RotateCcw aria-hidden="true" size={16} />
        Try again
      </button>
    </div>
  );
}
