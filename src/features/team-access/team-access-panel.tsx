import { TeamAccessWorkspace } from "./team-access-workspace";
import { loadTeamAccessData } from "./queries";
import styles from "./team-access.module.css";

export async function TeamAccessPanel({
  page,
  search,
}: {
  page?: number | undefined;
  search?: string | undefined;
}) {
  const result = await loadTeamAccessData({ page, search });

  return result.ok ? (
    <TeamAccessWorkspace data={result.data} />
  ) : (
    <div className={styles.error} role="alert">
      {result.message}
    </div>
  );
}
