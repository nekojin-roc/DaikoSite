import Fastify, { type FastifyInstance } from "fastify";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { Identity, IdentityResolver } from "./identity.js";
import path from "node:path";
import { EventImportError, fetchEventImport } from "./event-import.js";
import { InvalidRequestImage, openRequestImage, removeRequestImage } from "./request-images.js";
import { batchInput, createRequests, requestInput, RequestSubmissionError } from "./request-submission.js";
import { hasEventImage, localImageFilename, openEventImage, saveEventImage } from "./event-images.js";

type User = Identity & { role: "ADMIN" | "USER" };
declare module "fastify" { interface FastifyRequest { daikoUser: User | null } }
const eventInput = z.object({
  name: z.string().trim().min(1).max(200),
  groupName: z.string().trim().min(1).max(200).optional(),
  groupId: z.string().trim().min(1).optional(),
  startsAt: z.string().datetime({ offset: true }),
  imageUrl: z.union([z.string().trim().url().refine(value => /^https?:\/\//i.test(value)), z.string().refine(value => localImageFilename(value) !== null), z.literal(""), z.null()]).optional(),
}).strict().refine(input => Boolean(input.groupId || input.groupName));
const nameInput = z.object({ name: z.string().trim().min(1).max(200) }).strict();
const eventSelect = { id: true, name: true, groupName: true, groupId: true, startsAt: true, imageUrl: true, _count: { select: { requests: { where: { finishedAt: null } } } } } as const;
function eventView(event: { id: string; name: string; groupName: string; groupId: string | null; startsAt: Date; imageUrl: string | null; _count: { requests: number } }) {
  return { id: event.id, name: event.name, groupName: event.groupName, groupId: event.groupId, startsAt: event.startsAt, imageUrl: event.imageUrl, requestCount: event._count.requests };
}
function requestView(item: { id: string; type: string; amount: number | null; message: string; createdAt: Date; finishedAt: Date | null; userName: string; userEmail: string; memberName: string | null; offeringName: string | null; imageFile: string | null }) {
  return { id: item.id, type: item.type, amount: item.amount, message: item.message, memberName: item.memberName, offeringName: item.offeringName, imageUrl: item.imageFile ? `/daiko-api/requests/${item.id}/image` : null, createdAt: item.createdAt, finishedAt: item.finishedAt, user: { name: item.userName, email: item.userEmail } };
}

export async function createApp(options: { prisma: PrismaClient; resolveIdentity: IdentityResolver; adminEmails: string[]; allowedOrigins: string[]; logger?: boolean; eventImageDirectory?: string; requestImageDirectory?: string; importEvent?: typeof fetchEventImport }): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true, bodyLimit: 32 * 1024 });
  const imageDirectory = options.eventImageDirectory ?? path.resolve("data/event-images");
  const requestImageDirectory = options.requestImageDirectory ?? path.resolve("data/request-images");
  const importEvent = options.importEvent ?? fetchEventImport;
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
    if (error instanceof RequestSubmissionError) return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof InvalidRequestImage) return reply.code(400).send({ error: "Invalid image; use a JPEG, PNG, WebP, or GIF up to 5 MiB" });
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return reply.code(409).send({ error: "A name already exists" });
    if (error instanceof EventImportError) return reply.code(error.statusCode).send({ error: error.message });
    if (error instanceof Error && "statusCode" in error && (error.statusCode === 400 || error.statusCode === 413)) {
      return reply.code(error.statusCode).send({ error: error.statusCode === 413 ? "Request body is too large" : "Invalid request body" });
    }
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
  app.get("/api/build", { preHandler: auth }, async (_request, reply) => {
    const counter = await options.prisma.buildCounter.findUnique({ where: { id: 1 }, select: { value: true } });
    if (!counter) return reply.code(503).send({ error: "Build number unavailable" });
    return { build: counter.value };
  });
  app.get("/api/groups", { preHandler: auth }, async () => ({
    groups: await options.prisma.group.findMany({
      select: { id: true, name: true, members: { select: { id: true, name: true }, orderBy: { name: "asc" } }, offerings: { where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" } } },
      orderBy: { name: "asc" },
    }),
  }));
  app.post("/api/groups", { preHandler: admin }, async (request, reply) => {
    const input = nameInput.parse(request.body);
    const group = await options.prisma.group.create({ data: input, select: { id: true, name: true } });
    return reply.code(201).send({ ...group, members: [], offerings: [] });
  });
  app.patch<{ Params: { id: string } }>("/api/groups/:id", { preHandler: admin }, async (request, reply) => {
    const input = nameInput.parse(request.body);
    const result = await options.prisma.$transaction(async tx => {
      const updated = await tx.group.updateMany({ where: { id: request.params.id }, data: input });
      if (!updated.count) return null;
      await tx.event.updateMany({ where: { groupId: request.params.id }, data: { groupName: input.name } });
      return tx.group.findUnique({ where: { id: request.params.id }, select: { id: true, name: true } });
    });
    if (!result) return reply.code(404).send({ error: "Group not found" });
    return result;
  });
  app.post<{ Params: { id: string } }>("/api/groups/:id/members", { preHandler: admin }, async (request, reply) => {
    const input = nameInput.parse(request.body);
    if (!await options.prisma.group.findUnique({ where: { id: request.params.id } })) return reply.code(404).send({ error: "Group not found" });
    const member = await options.prisma.member.create({ data: { ...input, groupId: request.params.id }, select: { id: true, name: true } });
    return reply.code(201).send(member);
  });
  app.patch<{ Params: { id: string; memberId: string } }>("/api/groups/:id/members/:memberId", { preHandler: admin }, async (request, reply) => {
    const input = nameInput.parse(request.body);
    const result = await options.prisma.member.updateMany({ where: { id: request.params.memberId, groupId: request.params.id }, data: input });
    if (!result.count) return reply.code(404).send({ error: "Member not found" });
    return { id: request.params.memberId, name: input.name };
  });
  app.post<{ Params: { id: string } }>("/api/groups/:id/offerings", { preHandler: admin }, async (request, reply) => {
    const input = nameInput.parse(request.body);
    if (!await options.prisma.group.findUnique({ where: { id: request.params.id } })) return reply.code(404).send({ error: "Group not found" });
    const offering = await options.prisma.offering.create({ data: { ...input, groupId: request.params.id }, select: { id: true, name: true } });
    return reply.code(201).send(offering);
  });
  app.patch<{ Params: { id: string; offeringId: string } }>("/api/groups/:id/offerings/:offeringId", { preHandler: admin }, async (request, reply) => {
    const input = nameInput.parse(request.body);
    const result = await options.prisma.offering.updateMany({ where: { id: request.params.offeringId, groupId: request.params.id, archived: false }, data: input });
    if (!result.count) return reply.code(404).send({ error: "Offering not found" });
    return { id: request.params.offeringId, name: input.name };
  });
  app.delete<{ Params: { id: string; offeringId: string } }>("/api/groups/:id/offerings/:offeringId", { preHandler: admin }, async (request, reply) => {
    const result = await options.prisma.offering.updateMany({ where: { id: request.params.offeringId, groupId: request.params.id, archived: false }, data: { archived: true } });
    if (!result.count) return reply.code(404).send({ error: "Offering not found" });
    return reply.code(204).send();
  });
  app.get("/api/events", { preHandler: auth }, async () => {
    const [events, counts] = await Promise.all([
      options.prisma.event.findMany({ select: eventSelect, orderBy: [{ startsAt: "asc" }, { id: "asc" }] }),
      options.prisma.request.groupBy({ by: ["eventId"], _count: { _all: true } }),
    ]);
    const totals = new Map(counts.map(count => [count.eventId, count._count._all]));
    return { events: events.map(event => ({ ...eventView(event), totalRequestCount: totals.get(event.id) ?? 0 })) };
  });
  app.post("/api/events/import", { preHandler: admin }, async request => {
    const { url } = z.object({ url: z.string().trim().min(1).max(2048) }).strict().parse(request.body);
    const imported = await importEvent(url);
    const imageUrl = await saveEventImage(imageDirectory, imported.image, imported.contentType);
    return { name: imported.name, imageUrl, startsAt: imported.startsAt };
  });
  app.get<{ Params: { filename: string } }>("/api/event-images/:filename", { preHandler: auth }, async (request, reply) => {
    const image = await openEventImage(imageDirectory, request.params.filename);
    if (!image) return reply.code(404).send({ error: "Image not found" });
    return reply.header("X-Content-Type-Options", "nosniff").type(image.contentType).send(image.stream);
  });
  app.post("/api/events", { preHandler: admin }, async (request, reply) => {
    const input = eventInput.parse(request.body);
    if (input.imageUrl && localImageFilename(input.imageUrl) && !await hasEventImage(imageDirectory, input.imageUrl)) {
      return reply.code(400).send({ error: "Imported image not found. Fetch the event again." });
    }
    const group = input.groupId ? await options.prisma.group.findUnique({ where: { id: input.groupId } }) : null;
    if (input.groupId && !group) return reply.code(404).send({ error: "Group not found" });
    const event = await options.prisma.event.create({ data: { name: input.name, groupId: group?.id ?? null, groupName: group?.name ?? input.groupName!, startsAt: new Date(input.startsAt), imageUrl: input.imageUrl || null }, select: eventSelect });
    return reply.code(201).send({ ...eventView(event), totalRequestCount: 0 });
  });
  app.delete<{ Params: { id: string } }>("/api/events/:id", { preHandler: admin }, async (request, reply) => {
    // Delete the event and its queue together. Imported event images are
    // content-addressed and may be shared, so they are left untouched.
    const result = await options.prisma.$transaction(async tx => {
      const event = await tx.event.findUnique({ where: { id: request.params.id }, select: { id: true } });
      if (!event) return null;
      const items = await tx.request.findMany({ where: { eventId: event.id }, select: { imageFile: true } });
      const images = [...new Set(items.flatMap(item => item.imageFile ? [item.imageFile] : []))];
      await tx.request.deleteMany({ where: { eventId: event.id } });
      await tx.event.delete({ where: { id: event.id } });
      // Defend against an unexpected shared filename in historical data.
      const retained = await tx.request.findMany({ where: { imageFile: { in: images } }, select: { imageFile: true } });
      const retainedFiles = new Set(retained.map(item => item.imageFile));
      return images.filter(filename => !retainedFiles.has(filename));
    });
    if (!result) return reply.code(404).send({ error: "Event not found" });
    // File cleanup happens after commit; a filesystem error must not imply
    // that the already-committed database deletion was rolled back.
    for (const filename of result) {
      try { await removeRequestImage(requestImageDirectory, filename); }
      catch (error) { request.log.error({ err: error, filename }, "Failed to remove deleted request image"); }
    }
    return reply.code(204).send();
  });
  app.get<{ Params: { id: string } }>("/api/events/:id/requests", { preHandler: admin }, async (request, reply) => {
    const event = await options.prisma.event.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const items = await options.prisma.request.findMany({ where: { eventId: event.id, finishedAt: null }, orderBy: [{ createdAt: "asc" }, { sequence: "asc" }] });
    // Goods submissions are one card each and take priority; stable sorting
    // retains submission order within each category.
    items.sort((a, b) => Number(b.type === "GOODS") - Number(a.type === "GOODS"));
    return { requests: items.map(requestView) };
  });
  app.get<{ Params: { id: string } }>("/api/events/:id/requests/completed", { preHandler: admin }, async (request, reply) => {
    const event = await options.prisma.event.findUnique({ where: { id: request.params.id }, select: { id: true } });
    if (!event) return reply.code(404).send({ error: "Event not found" });
    const items = await options.prisma.request.findMany({
      where: { eventId: event.id, finishedAt: { not: null } },
      orderBy: [{ finishedAt: "asc" }, { sequence: "asc" }],
    });
    return { requests: items.map(requestView) };
  });
  app.post<{ Params: { id: string } }>("/api/requests/:id/finish", { preHandler: admin }, async (request, reply) => {
    // Marking rather than deleting preserves the request in the user's history.
    const updated = await options.prisma.request.updateMany({ where: { id: request.params.id, finishedAt: null }, data: { finishedAt: new Date() } });
    if (!updated.count && !await options.prisma.request.findUnique({ where: { id: request.params.id }, select: { id: true } })) return reply.code(404).send({ error: "Request not found" });
    return reply.code(204).send();
  });
  const submitOptions = { preHandler: auth, bodyLimit: 8 * 1024 * 1024 };
  app.post<{ Params: { id: string } }>("/api/events/:id/requests", submitOptions, async (request, reply) => {
    const inputs = [requestInput.parse(request.body)];
    const [item] = await createRequests(options.prisma, requestImageDirectory, request.params.id, request.daikoUser!, inputs);
    return reply.code(201).send(requestView(item));
  });
  app.post<{ Params: { id: string } }>("/api/events/:id/requests/batch", submitOptions, async (request, reply) => {
    const { requests } = batchInput.parse(request.body);
    const items = await createRequests(options.prisma, requestImageDirectory, request.params.id, request.daikoUser!, requests);
    return reply.code(201).send({ requests: items.map(requestView) });
  });
  app.get<{ Params: { id: string } }>("/api/requests/:id/image", { preHandler: auth }, async (request, reply) => {
    const item = await options.prisma.request.findUnique({ where: { id: request.params.id }, select: { imageFile: true, userId: true } });
    if (!item?.imageFile || (request.daikoUser!.role !== "ADMIN" && item.userId !== request.daikoUser!.id)) return reply.code(404).send({ error: "Image not found" });
    const image = await openRequestImage(requestImageDirectory, item.imageFile);
    if (!image) return reply.code(404).send({ error: "Image not found" });
    return reply.header("X-Content-Type-Options", "nosniff").type(image.contentType).send(image.stream);
  });
  app.get("/api/my-requests", { preHandler: auth }, async request => {
    const items = await options.prisma.request.findMany({ where: { userId: request.daikoUser!.id }, include: { event: { select: eventSelect } }, orderBy: [{ createdAt: "asc" }, { sequence: "asc" }] });
    return { requests: items.map(item => ({ ...requestView(item), event: eventView(item.event) })) };
  });
  return app;
}
