import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ENV_FILES = [".env.local", ".env"] as const;

function unquote(value: string): string {
  const quote = value.at(0);

  if ((quote === '"' || quote === "'") && value.at(-1) === quote) {
    const unquoted = value.slice(1, -1);

    return quote === '"'
      ? unquoted.replaceAll("\\n", "\n").replaceAll('\\"', '"').replaceAll("\\\\", "\\")
      : unquoted;
  }

  return value;
}

function readFromEnvFile(name: string): string | undefined {
  for (const fileName of ENV_FILES) {
    const filePath = resolve(process.cwd(), fileName);

    if (!existsSync(filePath)) {
      continue;
    }

    const lines = readFileSync(filePath, "utf8").split(/\r?\n/u);

    for (const line of lines) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=(.*)$/u);

      if (match?.[1] !== name) {
        continue;
      }

      const rawValue = match[2]?.trim() ?? "";
      return unquote(rawValue);
    }
  }

  return undefined;
}

export function getE2EEnvironmentVariable(name: string): string | undefined {
  const value = process.env[name] ?? readFromEnvFile(name);
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

export interface E2ECredentials {
  password: string;
  phone: string;
}

export function getRoleCredentials(roleKey: string): E2ECredentials | null {
  const phoneVariable = `E2E_${roleKey}_PHONE`;
  const passwordVariable = `E2E_${roleKey}_PASSWORD`;
  const phone = getE2EEnvironmentVariable(phoneVariable);
  const password = getE2EEnvironmentVariable(passwordVariable);

  if (Boolean(phone) !== Boolean(password)) {
    throw new Error(
      `Authenticated E2E configuration is incomplete. Set both ${phoneVariable} and ${passwordVariable}, or leave both empty.`,
    );
  }

  return phone && password ? { phone, password } : null;
}
