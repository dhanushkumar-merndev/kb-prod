import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoginForm } from "@/features/auth/login-form";
import type { LoginActionFailure } from "@/features/auth/types";

describe("LoginForm", () => {
  it("shows only the required login controls and no role picker", () => {
    const authenticate = vi.fn(async (): Promise<LoginActionFailure> => ({
      ok: false,
      code: "AUTH_INVALID_CREDENTIALS",
      message: "Incorrect credentials.",
    }));

    render(<LoginForm authenticate={authenticate} />);

    expect(screen.getByLabelText("Phone number")).toHaveAttribute("type", "tel");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("shows field-level validation without calling the server", async () => {
    const user = userEvent.setup();
    const authenticate = vi.fn(async (): Promise<LoginActionFailure> => ({
      ok: false,
      code: "AUTH_INVALID_CREDENTIALS",
      message: "Incorrect credentials.",
    }));

    render(<LoginForm authenticate={authenticate} />);

    await user.type(screen.getByLabelText("Phone number"), "123");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(
      await screen.findByText("Enter a valid 10-digit Indian mobile number."),
    ).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("lets the user show and hide the password", async () => {
    const user = userEvent.setup();
    const authenticate = vi.fn(async (): Promise<LoginActionFailure> => ({
      ok: false,
      code: "AUTH_INVALID_CREDENTIALS",
      message: "Incorrect credentials.",
    }));

    render(<LoginForm authenticate={authenticate} />);

    const password = screen.getByLabelText("Password");
    expect(password).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("renders a safe server error in the status area", async () => {
    const user = userEvent.setup();
    const authenticate = vi.fn(async (): Promise<LoginActionFailure> => ({
      ok: false,
      code: "ACCOUNT_BLOCKED",
      message: "Your account has been blocked. Please contact HR or your Manager.",
    }));

    render(<LoginForm authenticate={authenticate} />);

    await user.type(screen.getByLabelText("Phone number"), "9876543210");
    await user.type(screen.getByLabelText("Password"), "correct horse");
    await user.click(screen.getByRole("button", { name: "Log in" }));

    expect(
      await screen.findByRole("alert", {
        name: "",
      }),
    ).toHaveTextContent("Your account has been blocked. Please contact HR or your Manager.");
    expect(authenticate).toHaveBeenCalledTimes(1);
  });
});
