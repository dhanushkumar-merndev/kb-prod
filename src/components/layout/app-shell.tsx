"use client";

import {
  BarChart3,
  BriefcaseBusiness,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  Clock3,
  CreditCard,
  Gauge,
  IndianRupee,
  LayoutDashboard,
  LogIn,
  Menu,
  MessageSquareText,
  PlugZap,
  ReceiptIndianRupee,
  UserRoundCheck,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";

import type { Role } from "@/lib/constants/roles";
import {
  ROLE_DISPLAY_NAMES,
  type NavigationIcon,
  type RoleNavigationItem,
} from "@/lib/navigation/role-navigation";

import styles from "./app-shell.module.css";

interface AppShellProps {
  children: ReactNode;
  logoutControl: ReactNode;
  navigation: readonly RoleNavigationItem[];
  notificationControl: ReactNode;
  sessionControl: ReactNode;
  profile: {
    fullName: string;
    phone: string;
    role: Role;
  };
}

const ICONS: Record<NavigationIcon, ComponentType<{ size?: number; strokeWidth?: number }>> = {
  dashboard: LayoutDashboard,
  leads: UserRoundCheck,
  conversations: MessageSquareText,
  bookings: BriefcaseBusiness,
  payments: CreditCard,
  team: UsersRound,
  attendance: Clock3,
  expenses: ReceiptIndianRupee,
  tasks: ClipboardCheck,
  leave: CalendarRange,
  meetings: CalendarDays,
  payroll: IndianRupee,
  reports: BarChart3,
  activity: LogIn,
  integrations: PlugZap,
};

function Navigation({
  items,
  pathname,
  onNavigate,
}: {
  items: readonly RoleNavigationItem[];
  pathname: string;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Primary navigation" className={styles.navigation}>
      {items.map((item) => {
        const Icon = ICONS[item.icon] ?? Gauge;
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            aria-current={isActive ? "page" : undefined}
            className={[styles.navLink, isActive ? styles.navLinkActive : ""]
              .filter(Boolean)
              .join(" ")}
            href={item.href}
            key={item.href}
            {...(onNavigate ? { onClick: onNavigate } : {})}
          >
            <Icon size={18} strokeWidth={1.9} />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({
  children,
  logoutControl,
  navigation,
  notificationControl,
  sessionControl,
  profile,
}: AppShellProps) {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const activeItem =
    navigation.find((item) => pathname === item.href || pathname.startsWith(`${item.href}/`)) ??
    navigation[0];

  useEffect(() => {
    if (!drawerOpen) {
      return;
    }

    const menuButton = menuButtonRef.current;
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusTimer = window.setTimeout(() => closeButtonRef.current?.focus(), 0);

    const handleDrawerKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDrawerOpen(false);
        return;
      }

      if (event.key !== "Tab" || !drawerRef.current) {
        return;
      }

      const focusable = Array.from(
        drawerRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => !element.hasAttribute("hidden"));
      const first = focusable[0];
      const last = focusable.at(-1);

      if (!first || !last) {
        event.preventDefault();
        return;
      }

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleDrawerKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleDrawerKeyDown);
      (previouslyFocused ?? menuButton)?.focus();
    };
  }, [drawerOpen]);

  return (
    <div className={styles.shell}>
      <div className={styles.notificationControl}>{notificationControl}</div>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <span className={styles.brandMark} aria-hidden="true">
            KB
          </span>
          <span>
            <strong>Khana Banao</strong>
            <small>Operations CRM</small>
          </span>
        </div>
        <Navigation items={navigation} pathname={pathname} />
        <div className={styles.sidebarFooter}>
          {sessionControl}
          <div className={styles.profile}>
            <span className={styles.avatar} aria-hidden="true">
              {profile.fullName.slice(0, 1).toUpperCase()}
            </span>
            <span className={styles.profileCopy}>
              <strong>{profile.fullName}</strong>
              <small>{ROLE_DISPLAY_NAMES[profile.role]}</small>
            </span>
          </div>
          {logoutControl}
        </div>
      </aside>

      <header className={styles.mobileBar}>
        <button
          aria-controls="mobile-navigation"
          aria-expanded={drawerOpen}
          aria-label="Open navigation"
          className={styles.menuButton}
          onClick={() => setDrawerOpen(true)}
          ref={menuButtonRef}
          type="button"
        >
          <Menu size={22} />
        </button>
        <div className={styles.mobileTitle}>
          <span>Khana Banao</span>
          <strong>{activeItem?.label ?? ROLE_DISPLAY_NAMES[profile.role]}</strong>
        </div>
        <span className={styles.mobileAvatar} aria-hidden="true">
          {profile.fullName.slice(0, 1).toUpperCase()}
        </span>
      </header>

      {drawerOpen ? (
        <div className={styles.drawerLayer}>
          <button
            aria-label="Close navigation"
            className={styles.backdrop}
            onClick={() => setDrawerOpen(false)}
            type="button"
          />
          <aside
            aria-label="Mobile navigation"
            aria-modal="true"
            className={styles.drawer}
            id="mobile-navigation"
            ref={drawerRef}
            role="dialog"
          >
            <div className={styles.drawerHeader}>
              <div className={styles.brand}>
                <span className={styles.brandMark} aria-hidden="true">
                  KB
                </span>
                <span>
                  <strong>Khana Banao</strong>
                  <small>{ROLE_DISPLAY_NAMES[profile.role]}</small>
                </span>
              </div>
              <button
                aria-label="Close navigation"
                className={styles.menuButton}
                onClick={() => setDrawerOpen(false)}
                ref={closeButtonRef}
                type="button"
              >
                <X size={22} />
              </button>
            </div>
            <Navigation
              items={navigation}
              pathname={pathname}
              onNavigate={() => setDrawerOpen(false)}
            />
            <div className={styles.drawerFooter}>
              {sessionControl}
              <span>{profile.phone}</span>
              {logoutControl}
            </div>
          </aside>
        </div>
      ) : null}

      <main className={styles.main}>{children}</main>
    </div>
  );
}
