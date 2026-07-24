import { loadOwnExpenseCrudData } from "../queries";
import { ExpenseWorkspace } from "./expense-workspace";
import { CrudErrorState } from "./shared";

export async function OwnExpenseCrudPanel() {
  const result = await loadOwnExpenseCrudData();

  if (!result.ok) {
    return <CrudErrorState message={result.message} requestId={result.requestId} />;
  }

  return <ExpenseWorkspace data={result.data} />;
}
