import { loadTaskCrudData } from "../queries";
import { CrudErrorState } from "./shared";
import { TaskWorkspace } from "./task-workspace";

export async function TaskCrudPanel() {
  const result = await loadTaskCrudData();

  if (!result.ok) {
    return <CrudErrorState message={result.message} requestId={result.requestId} />;
  }

  return <TaskWorkspace data={result.data} />;
}
