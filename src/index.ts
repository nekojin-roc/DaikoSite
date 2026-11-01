import { PrismaClient } from "@prisma/client";
import { createApp } from "./app.js";
import { parcelHubIdentity } from "./identity.js";

const required = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be set`);
  return value;
};
const prisma = new PrismaClient();
const app = await createApp({
  prisma,
  resolveIdentity: parcelHubIdentity(required("PARCELHUB_URL")),
  adminEmails: required("DAIKO_ADMIN_EMAILS").split(","),
  allowedOrigins: required("DAIKO_ALLOWED_ORIGINS").split(",").map(value => value.trim()).filter(Boolean),
});
app.addHook("onClose", async () => { await prisma.$disconnect(); });
const close = async () => { await app.close(); process.exit(0); };
process.on("SIGTERM", close);
process.on("SIGINT", close);
try {
  await app.listen({ host: process.env.HOST ?? "127.0.0.1", port: Number(process.env.PORT ?? 3002) });
} catch (error) { app.log.error(error); process.exit(1); }
