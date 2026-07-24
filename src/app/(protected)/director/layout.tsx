import { RoleWorkspaceLayout } from "@/components/layout/role-workspace-layout";

export default function DirectorLayout({ children }: { children: React.ReactNode }) {
  return <RoleWorkspaceLayout allowedRoles={["director"]}>{children}</RoleWorkspaceLayout>;
}
