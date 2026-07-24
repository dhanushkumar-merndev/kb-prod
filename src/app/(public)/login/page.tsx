import type { Metadata } from "next";

import { getLoginNotice } from "@/lib/auth/account-status";
import { loginAction } from "@/features/auth/actions";
import { LoginForm } from "@/features/auth/login-form";

import styles from "./login-page.module.css";

export const metadata: Metadata = {
  title: "Log in",
  description: "Secure staff login for Khana Banao CRM.",
};

interface LoginPageProps {
  searchParams: Promise<{
    status?: string | string[];
  }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { status } = await searchParams;
  const notice = getLoginNotice(status);

  return (
    <main className={styles.page}>
      <section className={styles.brand} aria-label="Khana Banao">
        <div className={styles.logo}>
          Khana<span className={styles.logoAccent}>Banao</span>
        </div>
        <div className={styles.brandCopy}>
          <h1>
            One kitchen.
            <br />
            One connected
            <br />
            operation.
          </h1>
          <p>
            Leads, bookings, kitchen work and workforce operations stay connected while every staff
            member sees only what their role allows.
          </p>
        </div>
        <div className={styles.brandFooter}>Secure role-based operations</div>
      </section>

      <section className={styles.formSide} aria-labelledby="login-title">
        <div className={styles.formBox}>
          <div className={`${styles.logo} ${styles.mobileLogo}`}>
            Khana<span className={styles.logoAccent}>Banao</span>
          </div>
          <h2 id="login-title">Welcome back</h2>
          <p>Log in with the phone number linked to your staff account.</p>
          <LoginForm authenticate={loginAction} initialNotice={notice} />
        </div>
      </section>
    </main>
  );
}
