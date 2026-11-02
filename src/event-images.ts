import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const imageTypes: Record<string, string> = {
  jpg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", avif: "image/avif",
};
const filenamePattern = /^[a-f0-9]{64}\.(jpg|png|webp|gif|avif)$/;
const imagePrefix = "/daiko-api/event-images/";

export function localImageFilename(url: string): string | null {
  const filename = url.startsWith(imagePrefix) ? url.slice(imagePrefix.length) : "";
  return filenamePattern.test(filename) ? filename : null;
}

export async function saveEventImage(directory: string, image: Buffer, contentType: string): Promise<string> {
  const extension = Object.keys(imageTypes).find(key => imageTypes[key] === contentType);
  if (!extension) throw new Error("Unsupported imported image type");
  const filename = `${createHash("sha256").update(image).digest("hex")}.${extension}`;
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, image, { flag: "wx" });
    await rename(temporary, path.join(directory, filename));
  } finally {
    await rm(temporary, { force: true });
  }
  return `${imagePrefix}${filename}`;
}

export async function hasEventImage(directory: string, url: string): Promise<boolean> {
  const filename = localImageFilename(url);
  if (!filename) return false;
  try { return (await stat(path.join(directory, filename))).isFile(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function openEventImage(directory: string, filename: string) {
  if (!filenamePattern.test(filename)) return null;
  try {
    const file = await open(path.join(directory, filename), "r");
    return { stream: file.createReadStream(), contentType: imageTypes[filename.split(".").pop()!] };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
