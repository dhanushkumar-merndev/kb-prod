import styles from "./workspace-state.module.css";

export function WorkspaceLoading() {
  return (
    <div aria-busy="true" aria-label="Loading workspace" className={styles.loading}>
      <div className={styles.headerSkeleton}>
        <span />
        <span />
      </div>
      <div className={styles.cardGrid}>
        {Array.from({ length: 4 }).map((_, index) => (
          <span key={index} />
        ))}
      </div>
      <div className={styles.tableSkeleton} />
    </div>
  );
}
