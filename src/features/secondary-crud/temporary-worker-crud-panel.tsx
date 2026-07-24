import { CrudErrorState } from "@/features/core-crud/components/shared";

import { loadTemporaryWorkerCrudData } from "./queries";
import { TemporaryWorkerWorkspace } from "./temporary-worker-workspace";

export async function TemporaryWorkerCrudPanel() {
  const result = await loadTemporaryWorkerCrudData();

  if (!result.ok) {
    return <CrudErrorState message={result.message} requestId={result.requestId} />;
  }

  return <TemporaryWorkerWorkspace data={result.data} />;
}
