import { loadOwnLeaveCrudData } from "../queries";
import { LeaveWorkspace } from "./leave-workspace";
import { CrudErrorState } from "./shared";

export async function OwnLeaveCrudPanel() {
  const result = await loadOwnLeaveCrudData();

  if (!result.ok) {
    return <CrudErrorState message={result.message} requestId={result.requestId} />;
  }

  return <LeaveWorkspace data={result.data} />;
}
