"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Eye, EyeOff } from "lucide-react";
import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";

import type { LoginNotice } from "@/lib/auth/account-status";

import styles from "./login-form.module.css";
import { loginSchema, type LoginFormInput } from "./schema";
import type { LoginActionFailure } from "./types";

interface LoginFormProps {
  authenticate: (input: LoginFormInput) => Promise<LoginActionFailure>;
  initialNotice?: LoginNotice | null;
}

function isNextRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof error.digest === "string" &&
    error.digest.startsWith("NEXT_REDIRECT;")
  );
}

export function LoginForm({ authenticate, initialNotice = null }: LoginFormProps) {
  const [isPending, startTransition] = useTransition();
  const [actionFailure, setActionFailure] = useState<LoginActionFailure | null>(null);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors },
  } = useForm<LoginFormInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      phone: "",
      password: "",
    },
  });

  const visibleNotice = actionFailure
    ? { message: actionFailure.message, tone: "error" as const }
    : initialNotice;

  const onSubmit = handleSubmit((values) => {
    if (isPending) {
      return;
    }

    setActionFailure(null);

    startTransition(async () => {
      try {
        const result = await authenticate(values);

        if (result.fieldErrors?.phone) {
          setError("phone", {
            type: "server",
            message: result.fieldErrors.phone,
          });
        }

        if (result.fieldErrors?.password) {
          setError("password", {
            type: "server",
            message: result.fieldErrors.password,
          });
        }

        setActionFailure(result);
      } catch (error) {
        // `redirect()` intentionally throws a Next.js navigation signal. It
        // must reach the router rather than being shown as a login failure.
        if (isNextRedirectError(error)) {
          throw error;
        }

        setActionFailure({
          ok: false,
          code: "INTERNAL_ERROR",
          message: "We could not log you in. Check your connection and try again.",
        });
      }
    });
  });

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <div
        className={[
          styles.status,
          visibleNotice ? styles.statusVisible : "",
          visibleNotice?.tone === "info" ? styles.statusInfo : styles.statusError,
        ]
          .filter(Boolean)
          .join(" ")}
        role={visibleNotice?.tone === "error" ? "alert" : "status"}
        aria-live="polite"
        aria-atomic="true"
      >
        {visibleNotice?.message}
        {actionFailure?.requestId ? (
          <span className={styles.supportCode}>Support code: {actionFailure.requestId}</span>
        ) : null}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="login-phone">
          Phone number
        </label>
        <input
          {...register("phone")}
          className={styles.input}
          id="login-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder="+91 98765 43210"
          aria-invalid={errors.phone ? "true" : "false"}
          aria-describedby={errors.phone ? "login-phone-error" : undefined}
          disabled={isPending}
        />
        {errors.phone ? (
          <p className={styles.fieldError} id="login-phone-error" role="alert">
            {errors.phone.message}
          </p>
        ) : null}
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="login-password">
          Password
        </label>
        <div className={styles.passwordControl}>
          <input
            {...register("password")}
            className={`${styles.input} ${styles.passwordInput}`}
            id="login-password"
            type={isPasswordVisible ? "text" : "password"}
            autoComplete="current-password"
            aria-invalid={errors.password ? "true" : "false"}
            aria-describedby={errors.password ? "login-password-error" : undefined}
            disabled={isPending}
          />
          <button
            className={styles.passwordToggle}
            type="button"
            aria-label={isPasswordVisible ? "Hide password" : "Show password"}
            aria-pressed={isPasswordVisible}
            disabled={isPending}
            onClick={() => setIsPasswordVisible((visible) => !visible)}
          >
            {isPasswordVisible ? (
              <EyeOff aria-hidden="true" size={19} strokeWidth={1.8} />
            ) : (
              <Eye aria-hidden="true" size={19} strokeWidth={1.8} />
            )}
          </button>
        </div>
        {errors.password ? (
          <p className={styles.fieldError} id="login-password-error" role="alert">
            {errors.password.message}
          </p>
        ) : null}
      </div>

      <button className={styles.submit} type="submit" disabled={isPending} aria-busy={isPending}>
        {isPending ? (
          <>
            <span className={styles.spinner} aria-hidden="true" />
            Logging in…
          </>
        ) : (
          "Log in"
        )}
      </button>
    </form>
  );
}
