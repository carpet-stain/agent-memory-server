import type { NextFunction, Request, Response } from "express";
import type { RoleContext, RoleRegistry } from "./registry.js";

export interface AuthedRequest extends Request {
  roleContext?: RoleContext;
}

// Per-role bearer over HTTPS (ADR-0046 §Auth) — each bearer resolves to its
// own Neon role via the registry, which validates against the full
// currently-valid set (rotation overlap, ADR-0003). Terminates TLS upstream
// of this process (Cloud Run ingress); this middleware only checks the
// header. A rotated-out token gets the same explicit 401 as a bad one —
// the client's signal to re-vend from SSM, never a silent no-op.
export function bearerAuth(registry: RoleRegistry) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const header = req.header("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme !== "Bearer" || !token) {
      res.status(401).json({ error: "missing bearer token" });
      return;
    }
    registry.resolve(token).then(
      (roleContext) => {
        if (!roleContext) {
          res.status(401).json({ error: "invalid bearer token" });
          return;
        }
        req.roleContext = roleContext;
        next();
      },
      (err: unknown) => next(err),
    );
  };
}
