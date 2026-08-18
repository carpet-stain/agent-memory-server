import type { NextFunction, Request, Response } from "express";
import type { RoleContext, RoleRegistry } from "./registry.js";

export interface AuthedRequest extends Request {
  roleContext?: RoleContext;
}

// Per-role static bearer over HTTPS (ADR-0046 §Auth) — each bearer resolves
// to its own Neon role via the registry built at boot. Terminates TLS
// upstream of this process (Cloud Run ingress); this middleware only checks
// the header.
export function bearerAuth(registry: RoleRegistry) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const header = req.header("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    const roleContext = registry.resolve(token);
    if (!roleContext) {
      res.status(401).json({ error: "invalid bearer token" });
      return;
    }
    req.roleContext = roleContext;
    next();
  };
}
