"use client";

import { useActionState } from "react";

import { ActionFeedback, SubmitButton } from "@/features/core-crud/components/shared";
import { INITIAL_CRUD_ACTION_STATE } from "@/features/core-crud/types";

import { assignChefAction } from "./actions";
import styles from "./workforce-management.module.css";

interface AssignmentPanelProps {
  data: {
    bookings: Array<{
      booking_id: string;
      booking_code: string;
      event_type: string;
      event_date: string;
      venue: string;
      service_status: string;
      chef_profile_id: string | null;
      chef_name: string | null;
    }>;
    chefs: Array<{
      id: string;
      full_name: string;
      role: "chef" | "part_time_chef";
    }>;
  };
}

export function AssignmentPanel({ data }: AssignmentPanelProps) {
  const [state, action] = useActionState(assignChefAction, INITIAL_CRUD_ACTION_STATE);

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <div>
          <h2>Assign Chef</h2>
          <p>Assign or replace the primary Chef on a confirmed booking.</p>
        </div>
      </div>
      {data.bookings.length === 0 || data.chefs.length === 0 ? (
        <p className={styles.empty}>
          A confirmed booking and an active Chef are required before assignment.
        </p>
      ) : (
        <form action={action} className={styles.formGrid}>
          <label className={styles.wide}>
            Booking
            <select name="bookingId" required>
              {data.bookings.map((booking) => (
                <option key={booking.booking_id} value={booking.booking_id}>
                  {booking.booking_code} · {booking.event_date} ·{" "}
                  {booking.chef_name ?? "Unassigned"}
                </option>
              ))}
            </select>
          </label>
          <label>
            Chef
            <select name="chefProfileId" required>
              {data.chefs.map((chef) => (
                <option key={chef.id} value={chef.id}>
                  {chef.full_name} · {chef.role.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label>
            Pay type
            <select name="agreedPayType" required>
              <option value="per_booking">Per booking</option>
              <option value="daily">Daily</option>
              <option value="hourly">Hourly</option>
              <option value="monthly">Monthly</option>
            </select>
          </label>
          <label>
            Agreed pay
            <input min="0" name="agreedPayAmount" required step="0.01" type="number" />
          </label>
          <label className={styles.wide}>
            Instructions
            <textarea name="instructions" />
          </label>
          <div className={styles.actions}>
            <SubmitButton>Assign Chef</SubmitButton>
          </div>
        </form>
      )}
      <ActionFeedback state={state} />
    </section>
  );
}
