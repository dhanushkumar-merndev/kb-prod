import { loadPayrollWorkspace } from "./queries";
import { PayrollWorkspace } from "./payroll-workspace";
import styles from "./payroll.module.css";

export async function PayrollPanel() {
  const result = await loadPayrollWorkspace();

  if (!result.ok) {
    return (
      <div className={styles.error} role="alert">
        <strong>Payroll is unavailable</strong>
        <p>{result.message}</p>
      </div>
    );
  }

  return <PayrollWorkspace data={result.data} />;
}
