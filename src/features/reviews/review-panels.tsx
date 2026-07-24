import {
  CoreCrudLoadingState,
  CrudErrorState,
} from "@/features/core-crud/components/shared";

import { loadExpenseReviews, loadLeaveReviews } from "./queries";
import { ExpenseReviewWorkspace, LeaveReviewWorkspace } from "./review-workspace";

export async function ExpenseReviewPanel() {
  const result = await loadExpenseReviews();

  return result.ok ? (
    <ExpenseReviewWorkspace records={result.records} viewerRole={result.viewerRole} />
  ) : (
    <CrudErrorState message={result.message} requestId={result.requestId} />
  );
}

export async function LeaveReviewPanel() {
  const result = await loadLeaveReviews();

  return result.ok ? (
    <LeaveReviewWorkspace records={result.records} />
  ) : (
    <CrudErrorState message={result.message} requestId={result.requestId} />
  );
}

export function ReviewLoadingState() {
  return <CoreCrudLoadingState label="Loading review records…" />;
}
