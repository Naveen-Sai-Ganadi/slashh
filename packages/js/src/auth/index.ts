/**
 * Shared, framework-agnostic auth primitives for the company brain.
 *
 * These are used across the stack:
 *  - the server verifies Cognito JWTs and maps claims → {@link AuthIdentity}
 *  - the web client uses the PKCE helpers + Hosted-UI URL builders to start
 *    the Authorization-Code-with-PKCE flow
 *
 * No runtime dependencies — PKCE/crypto uses the Web Crypto API available in
 * Node 18+ (`globalThis.crypto.subtle`) and every modern browser.
 */

/** A user's resolved identity, derived from a verified token (or a dev fallback). */
export interface AuthIdentity {
  /** stable subject — the username we key permissions on */
  user: string;
  /** group memberships (Cognito `cognito:groups`) used for ACL checks */
  groups: string[];
  email?: string;
}

/** The subset of Cognito access/ID-token claims we care about. */
export interface AuthClaims {
  sub: string;
  token_use?: "access" | "id";
  username?: string;
  "cognito:username"?: string;
  "cognito:groups"?: string[];
  email?: string;
  client_id?: string;
  aud?: string;
  iss?: string;
  exp?: number;
  [k: string]: unknown;
}

/** Public, client-safe Cognito configuration (no secrets). */
export interface CognitoPublicConfig {
  region: string;
  userPoolId: string;
  clientId: string;
  /** Hosted UI domain, e.g. `your-domain.auth.us-east-1.amazoncognito.com` */
  domain: string;
  /** OAuth scopes requested at the Hosted UI, space-joined when sent. */
  scopes: string[];
}

/** Map verified token claims to the identity the app authorizes against. */
export function claimsToIdentity(claims: AuthClaims): AuthIdentity {
  const user =
    claims.username ?? claims["cognito:username"] ?? (claims.email as string | undefined) ?? claims.sub;
  const groups = Array.isArray(claims["cognito:groups"]) ? (claims["cognito:groups"] as string[]) : [];
  return { user, groups, email: claims.email };
}

/* --------------------------------- PKCE ---------------------------------- */

function base64UrlEncode(bytes: Uint8Array): string {
  let str = "";
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === "function" ? btoa(str) : Buffer.from(bytes).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomBytes(n: number): Uint8Array {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}

/** A high-entropy URL-safe string (used for PKCE verifier + OAuth state). */
export function randomUrlSafe(bytes = 32): string {
  return base64UrlEncode(randomBytes(bytes));
}

export interface Pkce {
  verifier: string;
  challenge: string;
  method: "S256";
}

/** Generate a PKCE verifier + S256 challenge (RFC 7636). */
export async function generatePkce(): Promise<Pkce> {
  const verifier = randomUrlSafe(32);
  const data = new TextEncoder().encode(verifier);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return { verifier, challenge: base64UrlEncode(new Uint8Array(digest)), method: "S256" };
}

/* ----------------------------- Hosted UI URLs ---------------------------- */

/** Build the Cognito Hosted-UI `/oauth2/authorize` URL for Auth-Code + PKCE. */
export function buildHostedUiUrl(
  cfg: CognitoPublicConfig,
  opts: { redirectUri: string; state: string; codeChallenge: string }
): string {
  const q = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    scope: cfg.scopes.join(" "),
    redirect_uri: opts.redirectUri,
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `https://${cfg.domain}/oauth2/authorize?${q.toString()}`;
}

/** Build the Hosted-UI `/logout` URL that ends the Cognito session. */
export function buildLogoutUrl(cfg: CognitoPublicConfig, opts: { redirectUri: string }): string {
  const q = new URLSearchParams({ client_id: cfg.clientId, logout_uri: opts.redirectUri });
  return `https://${cfg.domain}/logout?${q.toString()}`;
}

/** The OIDC issuer URL for a user pool (used to verify `iss`). */
export function cognitoIssuer(region: string, userPoolId: string): string {
  return `https://cognito-idp.${region}.amazonaws.com/${userPoolId}`;
}
