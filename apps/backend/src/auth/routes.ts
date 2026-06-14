import { Hono } from "hono";
import { byIp, rateLimit } from "../middleware/ratelimit.ts";
import type { AppEnv } from "../types.ts";
import { clearSessionCookie, setSessionCookie } from "./identity.ts";
import { passwordLoginEnabled, verifyAdminPassword } from "./password.ts";

// Login/logout for the single-user dashboard.
//   GET  /auth/providers      -> whether password login is enabled
//   POST /auth/password/login -> verify ADMIN_PASSWORD, set the signed cookie
//   POST /auth/logout         -> clear the cookie

export const authRoutes = new Hono<AppEnv>();

// GET /auth/providers — the dashboard asks what sign-in methods exist.
authRoutes.get("/providers", (c) =>
  c.json({ password_login: passwordLoginEnabled() }),
);

// POST /auth/password/login. Tight per-IP limit: this is the one endpoint where
// online brute force pays.
authRoutes.post(
  "/password/login",
  rateLimit({
    name: "password-login",
    limit: 10,
    windowMs: 15 * 60_000,
    key: byIp,
  }),
  async (c) => {
    if (!passwordLoginEnabled()) {
      return c.json(
        { error: "password login is not enabled on this server" },
        503,
      );
    }

    const body = await c.req.json().catch(() => null);
    const password =
      body && typeof body === "object" && typeof body.password === "string"
        ? body.password
        : "";
    if (!verifyAdminPassword(password)) {
      return c.json({ error: "wrong password" }, 401);
    }

    await setSessionCookie(c);
    return c.body(null, 204);
  },
);

authRoutes.post("/logout", (c) => {
  clearSessionCookie(c);
  return c.body(null, 204);
});
