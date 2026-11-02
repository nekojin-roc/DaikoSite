import { randomUUID } from "node:crypto";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const maxBytes = 5 * 1024 * 1024;
const types: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };
const filenamePattern = /^[a-f0-9-]{36}\.(jpg|png|webp|gif)$/;
export class InvalidRequestImage extends Error {}
export function decodeRequestImage(image: { mimeType: string; data: string }) {
  const encoded = image.data;
  if (!encoded.length || encoded.length > Math.ceil(maxBytes / 3) * 4 || encoded.length % 4 !== 0) throw new InvalidRequestImage();
  if (/[^A-Za-z0-9+/=]/.test(encoded)) throw new InvalidRequestImage();
  const padding = encoded.indexOf("=");
  if (padding !== -1 && (padding < encoded.length - 2 || !/^={1,2}$/.test(encoded.slice(padding)))) throw new InvalidRequestImage();
  const bytes = Buffer.from(image.data, "base64");
  if (!bytes.length || bytes.length > maxBytes || bytes.toString("base64") !== image.data) throw new InvalidRequestImage();
  const is = (signature: number[]) => bytes.subarray(0, signature.length).equals(Buffer.from(signature));
  let ext = "";
  if (is([0xff, 0xd8, 0xff])) ext = "jpg";
  else if (is([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ext = "png";
  else if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") ext = "webp";
  else if (bytes.toString("ascii", 0, 6) === "GIF87a" || bytes.toString("ascii", 0, 6) === "GIF89a") ext = "gif";
  if (!ext || types[ext] !== image.mimeType) throw new InvalidRequestImage();
  return { bytes, ext };
}
export async function saveRequestImage(directory: string, image: ReturnType<typeof decodeRequestImage>) {
  await mkdir(directory, { recursive: true });
  const filename = `${randomUUID()}.${image.ext}`;
  await writeFile(path.join(directory, filename), image.bytes, { flag: "wx" });
  return filename;
}
export async function removeRequestImage(directory: string, filename: string) {
  if (filenamePattern.test(filename)) await rm(path.join(directory, filename), { force: true });
}
export async function openRequestImage(directory: string, filename: string) {
  if (!filenamePattern.test(filename)) return null;
  try {
    const file = await open(path.join(directory, filename), "r");
    return { stream: file.createReadStream(), contentType: types[filename.split(".").pop()!] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
