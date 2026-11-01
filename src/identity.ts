import { z } from "zod";

export type Identity = { id: string; name: string; email: string };
export type IdentityResolver = (cookie: string | undefined) => Promise<Identity | null>;

const sessionSchema = z.object({ user: z.object({ id: z.string().min(1), name: z.string(), email: z.string().email() }) });

/** Ask ParcelHub to validate the cookie, then run its guarded route so disabled
 * accounts and revoked sessions cannot use Daiko. Never trust browser identity. */
export function parcelHubIdentity(baseUrl: string): IdentityResolver {
  const base = new URL(baseUrl);
  if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw new Error("Invalid PARCELHUB_URL");
  return async (cookie) => {
    if (!cookie) return null;
    const headers = { cookie, accept: "application/json" };
    const options: RequestInit = { headers, redirect: "manual", signal: AbortSignal.timeout(5000) };
    const session = await fetch(new URL("/api/auth/get-session", base), options);
    if (session.status === 401 || session.status === 403) return null;
    if (!session.ok) throw new Error("ParcelHub session service unavailable");
    const raw: unknown = await session.json();
    if (raw === null) return null;
    const parsed = sessionSchema.safeParse(raw);
    if (!parsed.success) throw new Error("Invalid ParcelHub session response");
    const guarded = await fetch(new URL("/api/my/items", base), { headers, redirect: "manual", signal: AbortSignal.timeout(5000) });
    if (guarded.status === 401 || guarded.status === 403) return null;
    if (!guarded.ok) throw new Error("ParcelHub account check unavailable");
    await guarded.body?.cancel();
    return parsed.data.user;
  };
}
