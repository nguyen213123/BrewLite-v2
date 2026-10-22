// TV4: use these values when implementing IdentityPort and token issuance.
export const AUTH_POLICY = Object.freeze({
  algorithm: 'HS256',
  issuer: 'brewlite-api',
  audience: 'brewlite-web',
  expiresInSeconds: 3600,
  minSecretLength: 32,
  bcryptCost: 12,
});
