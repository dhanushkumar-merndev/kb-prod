import { CrudErrorState } from "@/features/core-crud/components/shared";

import { MeetingWorkspace } from "./meeting-workspace";
import { loadMeetingCrudData } from "./queries";

export async function MeetingCrudPanel() {
  const result = await loadMeetingCrudData();

  if (!result.ok) {
    return <CrudErrorState message={result.message} requestId={result.requestId} />;
  }

  return <MeetingWorkspace data={result.data} />;
}
