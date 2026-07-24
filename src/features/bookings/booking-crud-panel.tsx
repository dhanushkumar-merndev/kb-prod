import { loadBookingCrudData } from "./queries";
import { BookingWorkspace } from "./booking-workspace";
import styles from "./bookings.module.css";

interface BookingCrudPanelProps {
  page?: number | undefined;
  search?: string | undefined;
}

export async function BookingCrudPanel({ page = 1, search = "" }: BookingCrudPanelProps = {}) {
  const result = await loadBookingCrudData({ page, pageSize: 10, search });

  if (!result.ok) {
    return (
      <div className={styles.error} role="alert">
        {result.message}
      </div>
    );
  }

  return <BookingWorkspace data={result.data} />;
}
