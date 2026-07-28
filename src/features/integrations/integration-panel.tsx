import { loadEmailIntegration } from "./queries";
import { IntegrationWorkspace } from "./integration-workspace";

export async function IntegrationPanel() {
  const result = await loadEmailIntegration();
  if (!result.ok) return <p role="alert">{result.message}</p>;
  return <IntegrationWorkspace data={result.data} />;
}
