import { FranchisesWorkspace } from "./franchises-workspace";
import { loadFranchisesData } from "./queries";
import styles from "./franchises.module.css";

export async function FranchisesPanel() {
  const result = await loadFranchisesData();

  return result.ok ? (
    <FranchisesWorkspace franchises={result.data.franchises} />
  ) : (
    <div className={styles.error} role="alert">
      {result.message}
    </div>
  );
}
