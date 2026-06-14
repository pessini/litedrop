// The caller's identity. Core is single-user, so this carries only an opaque
// owner key; everything is owned by the one account. (A multi-tenant layer
// widens this with a real user id, email, admin flag, etc.)
export type OwnerKey = string & { readonly __ownerKey: unique symbol };

export interface Identity {
  owner: OwnerKey;
}

// Hono context typing shared across routes/middleware. Authed routes set the
// resolved identity here.
export type AppEnv = {
  Variables: {
    identity: Identity;
  };
};
