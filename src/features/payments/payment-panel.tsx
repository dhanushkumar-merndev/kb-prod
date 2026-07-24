import { loadPaymentData } from "./queries";
import { PaymentWorkspace } from "./payment-workspace";
import styles from "./payments.module.css";

export async function PaymentPanel() {
  const result = await loadPaymentData();

  if (!result.ok) {
    return (
      <div className={styles.error} role="alert">
        {result.message}
      </div>
    );
  }

  return <PaymentWorkspace data={result.data} />;
}
