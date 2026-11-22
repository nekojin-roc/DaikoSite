const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const REQUEST_IMAGE_ACCEPT = IMAGE_TYPES.join(',');
export const MAX_REQUEST_IMAGE_BYTES = 5 * 1024 * 1024;

export type RequestImage = { mimeType: string; data: string };

export function requestImageError(file: File): string {
  if (!IMAGE_TYPES.includes(file.type)) return 'Please choose a JPEG, PNG, WebP, or GIF image.';
  if (file.size > MAX_REQUEST_IMAGE_BYTES) return 'The image must be 5 MiB or smaller.';
  return '';
}

export function readRequestImage(file: File): Promise<RequestImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const fail = () => reject(new Error('Could not read the image. Please try again.'));
    reader.onload = () => {
      if (typeof reader.result !== 'string') return fail();
      const separator = reader.result.indexOf(',');
      if (separator < 0) return fail();
      resolve({ mimeType: file.type, data: reader.result.slice(separator + 1) });
    };
    reader.onerror = reader.onabort = fail;
    reader.readAsDataURL(file);
  });
}
