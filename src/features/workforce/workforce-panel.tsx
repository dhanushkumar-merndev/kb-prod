import { AlertTriangle } from "lucide-react";

import { loadWorkforceSelfService } from "./queries";
import { WorkforceWorkspace } from "./workforce-workspace";
import styles from "./workforce.module.css";

export function WorkforcePanel({ mode }: { mode: "attendance" | "jobs" }) {
  return <WorkforcePanelContent mode={mode} />;
}

async function WorkforcePanelContent({ mode }: { mode: "attendance" | "jobs" }) {
  const result = await loadWorkforceSelfService();

  if (!result.ok) {
    return (
      <div className={styles.error} role="alert">
        <AlertTriangle aria-hidden="true" size={20} />
        <span>{result.message}</span>
      </div>
    );
  }

  return <WorkforceWorkspace data={result.data} mode={mode} />;
}
