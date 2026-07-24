import { CrudErrorState } from "@/features/core-crud/components/shared";

import { loadEmployeeRecords } from "./queries";
import { EmployeeRecordsWorkspace } from "./employee-records-workspace";

export async function EmployeeRecordsPanel() {
  const result = await loadEmployeeRecords();

  return result.ok ? (
    <EmployeeRecordsWorkspace records={result.records} />
  ) : (
    <CrudErrorState message={result.message} requestId={result.requestId} />
  );
}
