import { loadSalesComplianceData } from "./queries";
import { SalesPerformanceWorkspace } from "./sales-performance-workspace";

export async function SalesPerformancePanel() {
  const result = await loadSalesComplianceData();
  if (!result.ok) {
    return (
      <div role="alert">
        <strong>Performance unavailable</strong>
        <p>{result.message}</p>
        <small>Support code: {result.requestId}</small>
      </div>
    );
  }
  return <SalesPerformanceWorkspace data={result.data} />;
}
