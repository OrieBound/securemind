"use client";

import { createContext, useContext } from "react";

export type AuthSession = {
  userId: string;
  email: string | null;
  role?: "super_admin" | "admin" | "member";
  logout: (reason?: string) => void | Promise<void>;
};

const AuthSessionContext = createContext<AuthSession | null>(null);

export function AuthSessionProvider({
  value,
  children,
}: {
  value: AuthSession | null;
  children: React.ReactNode;
}) {
  return (
    <AuthSessionContext.Provider value={value}>
      {children}
    </AuthSessionContext.Provider>
  );
}

/** Cognito session chrome — null in local auth mode. */
export function useAuthSession(): AuthSession | null {
  return useContext(AuthSessionContext);
}
