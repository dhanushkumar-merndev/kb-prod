import { z } from "zod";

import {
  ACCOUNT_STATUSES,
  ROLES,
  type AccountStatus as SharedAccountStatus,
  type Role,
} from "@/lib/constants/roles";

export type ProfileRole = Role;
export type AccountStatus = SharedAccountStatus;

export const authContextSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  full_name: z.string().min(1),
  phone_e164: z.string().regex(/^\+[1-9]\d{7,14}$/),
  role: z.enum(ROLES),
  account_status: z.enum(ACCOUNT_STATUSES),
  session_version: z.number().int().positive(),
});

export type AuthContext = z.infer<typeof authContextSchema>;

export interface AuthenticatedSession {
  userId: string;
  profile: AuthContext;
  sessionCode: string;
}
