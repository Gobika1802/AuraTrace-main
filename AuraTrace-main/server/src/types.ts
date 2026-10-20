import type { Context } from "hono";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export type AppVariables = {
  user: AuthUser;
  clientIp: string;
};

export type AppEnv = {
  Variables: AppVariables;
};

export type AppContext = Context<AppEnv>;
