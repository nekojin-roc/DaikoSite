import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { startOfJstDay } from "./event-day.js";
import type { Identity } from "./identity.js";
import { decodeRequestImage, removeRequestImage, saveRequestImage } from "./request-images.js";

const message = z.string().trim().min(1).max(5000);
const amount = z.number().int().min(1).max(1000);
const selectionId = z.string().min(1);
const imageInput = z.object({ mimeType: z.string(), data: z.string() }).strict();
export const requestInput = z.union([
  z.object({ type: z.literal("CHEKI"), amount, message }).strict(),
  z.object({ type: z.literal("GOODS"), amount: z.null().optional(), message }).strict(),
  z.object({
    memberId: selectionId,
    offeringId: selectionId,
    amount: amount.nullable().optional(),
    message,
    image: imageInput.optional(),
  }).strict(),
]);
export const batchInput = z.object({ requests: z.array(requestInput).min(1).max(10) }).strict();
export const requestEditInput = z.object({
  message,
  amount: amount.nullable().optional(),
  memberId: selectionId.optional(),
  offeringId: selectionId.optional(),
  image: imageInput.nullable().optional(),
}).strict();

export class RequestSubmissionError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

export async function createRequests(
  prisma: PrismaClient, imageDirectory: string, eventId: string,
  user: Identity, inputs: z.infer<typeof requestInput>[],
) {
  const images = inputs.map(input => "image" in input && input.image ? decodeRequestImage(input.image) : null);
  if (images.reduce((bytes, image) => bytes + (image?.bytes.length ?? 0), 0) > 5 * 1024 * 1024) {
    throw new RequestSubmissionError(400, "Images in one submission must total 5 MiB or less.");
  }

  const imageFiles: (string | null)[] = [];
  try {
    // Keep disk writes outside the database transaction. Each saved filename
    // belongs only to this submission and can be removed safely on rollback.
    for (const image of images) {
      imageFiles.push(image ? await saveRequestImage(imageDirectory, image) : null);
    }
    return await prisma.$transaction(async tx => {
      const event = await tx.event.findUnique({ where: { id: eventId }, select: { groupId: true, startsAt: true } });
      if (!event) throw new RequestSubmissionError(404, "Event not found");

      if (event.startsAt < startOfJstDay()) {
        throw new RequestSubmissionError(409, "This event is no longer accepting requests.");
      }

      const requests = [];
      for (const [index, input] of inputs.entries()) {
        const data = {
          eventId, userId: user.id, userName: user.name, userEmail: user.email,
          amount: input.amount ?? null, message: input.message,
        };
        if ("type" in input) {
          requests.push(await tx.request.create({ data: { ...data, type: input.type } }));
          continue;
        }
        const groupId = event.groupId;
        const member = groupId && await tx.member.findFirst({ where: { id: input.memberId, groupId } });
        const offering = groupId && await tx.offering.findFirst({ where: { id: input.offeringId, groupId, archived: false } });
        if (!member || !offering) {
          throw new RequestSubmissionError(400, "Select a valid member and offering for this event");
        }
        requests.push(await tx.request.create({ data: {
          ...data, type: "CUSTOM", memberName: member.name, offeringName: offering.name, imageFile: imageFiles[index],
        } }));
      }
      return requests;
    });
  } catch (error) {
    await Promise.all(imageFiles.map(file => file && removeRequestImage(imageDirectory, file)));
    throw error;
  }
}
