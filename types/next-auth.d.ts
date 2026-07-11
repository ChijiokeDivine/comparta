
import type { DefaultSession, DefaultUser, DefaultJWT } from "next-auth";
import type { DefaultAdapterUser } from "@auth/core/adapters";
import type { KybStatus, UserRole } from "@/app/generated/prisma";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      orgId: string;
      role: UserRole;
      kybStatus: KybStatus;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    id: string;
    orgId: string;
    role: UserRole;
    kybStatus: KybStatus;
  }

  interface AdapterUser extends DefaultAdapterUser {
    id: string;
    orgId: string;
    role: UserRole;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    orgId: string;
    role: UserRole;
    kybStatus: KybStatus;
  }
}

