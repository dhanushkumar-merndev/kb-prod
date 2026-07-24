import { loadLeadCrudData } from "../queries";
import { CrudErrorState } from "./shared";
import { LeadWorkspace } from "./lead-workspace";

export async function LeadCrudPanel({
  page,
  search,
}: {
  page?: number | undefined;
  search?: string | undefined;
}) {
  const result = await loadLeadCrudData({ page, search });

  if (!result.ok) {
    return <CrudErrorState message={result.message} requestId={result.requestId} />;
  }

  return <LeadWorkspace data={result.data} />;
}
