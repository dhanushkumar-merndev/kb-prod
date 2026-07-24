import { loadSalesOperationsData } from "./queries";
import { SalesOperationsWorkspace } from "./sales-operations-workspace";
import styles from "./sales-operations.module.css";
import type { SalesOperationsMode } from "./types";

export async function SalesOperationsPanel({ mode }: { mode: SalesOperationsMode }) {
  const result = await loadSalesOperationsData();

  if (!result.ok) {
    return (
      <div className={styles.error} role="alert">
        <strong>Sales operations could not be loaded</strong>
        <p>{result.message}</p>
        <span className={styles.supportCode}>Support code: {result.requestId}</span>
      </div>
    );
  }

  return <SalesOperationsWorkspace data={result.data} mode={mode} />;
}
