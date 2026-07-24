import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Role } from "@/lib/constants/roles";
import { ROLE_NAMESPACES, ROLE_NAVIGATION } from "@/lib/navigation/role-navigation";

const roles = Object.keys(ROLE_NAVIGATION) as Role[];
const protectedRoot = join(process.cwd(), "src", "app", "(protected)");

describe("role App Router files", () => {
  it.each(roles)("%s has a protected layout and concrete dashboard page", (role) => {
    const roleRoot = join(protectedRoot, ROLE_NAMESPACES[role]);

    expect(existsSync(join(roleRoot, "layout.tsx"))).toBe(true);
    expect(existsSync(join(roleRoot, "dashboard", "page.tsx"))).toBe(true);
    expect(existsSync(join(roleRoot, "loading.tsx"))).toBe(true);
    expect(existsSync(join(roleRoot, "error.tsx"))).toBe(true);
  });

  it.each(roles)("%s has a validated module route for every sidebar link", (role) => {
    const roleRoot = join(protectedRoot, ROLE_NAMESPACES[role]);
    const dynamicModulePage = join(roleRoot, "[module]", "page.tsx");

    expect(existsSync(dynamicModulePage)).toBe(true);
    expect(ROLE_NAVIGATION[role].length).toBeGreaterThan(1);
  });
});
