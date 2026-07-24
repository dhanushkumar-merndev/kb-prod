"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import styles from "./workspace-module.module.css";

export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      className={styles.refreshButton}
      disabled={pending}
      onClick={() => {
        startTransition(() => {
          router.refresh();
        });
      }}
      type="button"
    >
      <RefreshCw aria-hidden="true" className={pending ? styles.spinning : ""} size={16} />
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
