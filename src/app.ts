import Fastify, { type FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Identity, IdentityResolver } from "./identity.js";

type User = Identity & { role: "ADMIN" | "USER" };
declare module "fastify" { interface FastifyRequest { daikoUser: User | null } }
const eventInput = z.object({
  name: z.string().trim().min(1).max(200),
  groupName: z.string().trim().min(1).max(200),
  startsAt: z.string().datetime({ offset: true }),
  imageUrl: z.union([z.string().trim().url().refine(value => /^https?:\/\//i.test(value)), z.literal(""), z.null()]).optional(),
}).strict();
const requestInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CHEKI"), amount: z.number().int().min(1).max(1000), message: z.string().trim().min(1).max(5000) }).strict(),
  z.object({ type: z.literal("GOODS"), amount: z.null().optional(), message: z.string().trim().min(1).max(5000) }).strict(),
]);
const eventSelect = { id: true, name: true, groupName: true, startsAt: true, imageUrl: true, _count: { select: { requests: true } } } as const;
function eventView(event: { id: string; name: string; groupName: string; startsAt: Date; imageUrl: string | null; _count: { requests: number } }) {
  return { id: event.id, name: event.name, groupName: event.groupName, startsAt: event.startsAt, imageUrl: event.imageUrl, requestCount: event._count.requests };
}
function requestView(item: { id: string; type: string; amount: number | null; message: string; createdAt: Date; userName: string; userEmail: string }) {
  return { id: item.id, type: item.type, amount: item.amount, message: item.message, createdAt: item.createdAt, user: { name: item.userName, email: item.userEmail } };
}

export async function createApp(options: { prisma: PrismaClient; resolveIdentity: IdentityResolver; adminEmails: string[]; allowedOrigins: string[]; logger?: boolean }): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 32 * 1024 });
  const admins = new Set(options.adminEmails.map(value => value.trim().toLowerCase()).filter(Boolean));
  const origins = new Set(options.allowedOrigins.map(value => new URL(value).origin));
  app.decorateRequest("daikoUser", null);
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (request.method !== "GET" && request.method !== "HEAD") {
      if (!request.headers.origin || !origins.has(request.headers.origin)) return reply.code(403).send({ error: "Origin not allowed" });
    }
    if (request.url === "/api/health") return;
    try {
      const identity = await options.resolveIdentity(request.headers.cookie);
      if (identity) request.daikoUser = { ...identity, role: admins.has(identity.email.toLowerCase()) ? "ADMIN" : "USER" };
    } catch (error) {
      request.log.error(error, "ParcelHub authentication failed");
      return reply.code(503).send({ error: "Authentication service unavailable" });
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "Invalid input", details: error.flatten() });
    request.log.error(error);
    return reply.code(500).send({ error: "Unable to complete request" });
  });
  const auth = async (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    if (!request.daikoUser) return reply.code(401).send({ error: "Authentication required" });
  };
  const admin = async (request: import("fastify").FastifyRequest, reply: import("fastify").FastifyReply) => {
    if (!request.daikoUser) return reply.code(401).send({ error: "Authentication required" });
    if (request.daikoUser.role !== "ADMIN") return reply.code(403).send({ error: "Administrator access required" });
  };
  app.get("/api/health", async () => ({ status: "ok" }));
  app.get("/api/session", async request => ({ user: request.daikoUser }));
  app.get("/api/events", { preHandler: auth }, async () => ({ events: (await options.prisma.event.findMany({ select: eventSelect, orderBy: [{ startsAt: "asc" }, { id: "asc" }] })).map(eventView) }));
  app.post("/api/events", { preHandler: admin }, async (request, reply) => {
    const input = eventInput.parse(request.body);
    const event = await options.prisma.event.create({ data: { ...input, startsAt: new Date(input.startsAt), imageUrl: input.imageUrl || null }, select: eventSelect });
    return reply.code(201).send(eventView(event));
  });
  app.get<{ Params: { id: string } }>("/api/events/:id/requests", { preHandler: admin }, async (request, reply) => {
    const event = await options.prisma.event.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const items = await options.prisma.request.findMany({ where: { eventId: event.id }, orderBy: [{ createdAt: "asc" }, { sequence: "asc" }] });
    return { requests: items.map(requestView) };
  });
  app.post<{ Params: { id: string } }>("/api/events/:id/requests", { preHandler: auth }, async (request, reply) => {
    const input = requestInput.parse(request.body);
    const event = await options.prisma.event.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const user = request.daikoUser!;
    const item = await options.prisma.request.create({ data: { eventId: event.id, type: input.type, amount: input.type === "CHEKI" ? input.amount : null, message: input.message, userId: user.id, userName: user.name, userEmail: user.email } });
    return reply.code(201).send(requestView(item));
  });
  app.get("/api/my-requests", { preHandler: auth }, async request => {
    const items = await options.prisma.request.findMany({ where: { userId: request.daikoUser!.id }, include: { event: { select: eventSelect } }, orderBy: [{ createdAt: "asc" }, { sequence: "asc" }] });
    return { requests: items.map(item => ({ ...requestView(item), event: eventView(item.event) })) };
  });
  return app;
}
