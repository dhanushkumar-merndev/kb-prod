import { AssignmentPanel } from "./assignment-panel";
import { AttendanceReviewPanel } from "./attendance-review-panel";
import { loadAssignmentData, loadAttendanceReviewData } from "./queries";
import styles from "./workforce-management.module.css";

export async function BookingAssignmentPanel() {
  const result = await loadAssignmentData();

  return result.ok ? (
    <AssignmentPanel data={result.data} />
  ) : (
    <div className={styles.error} role="alert">
      {result.message}
    </div>
  );
}

export async function AttendanceApprovalPanel() {
  const result = await loadAttendanceReviewData();

  return result.ok ? (
    <AttendanceReviewPanel data={result.data} />
  ) : (
    <div className={styles.error} role="alert">
      {result.message}
    </div>
  );
}
