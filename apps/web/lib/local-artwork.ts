/**
 * Local-only artwork helpers. Never uploads. Always revoke object URLs on cleanup.
 */

export type LocalArtworkState =
  | { status: "empty"; objectUrl: null; error: null }
  | { status: "ready"; objectUrl: string; error: null }
  | { status: "error"; objectUrl: null; error: string };

export const PLACEHOLDER_ARTWORK_PATH = "/artwork/prism-placeholder.svg";

const MAX_BYTES = 8 * 1024 * 1024;

export function createEmptyArtworkState(): LocalArtworkState {
  return { status: "empty", objectUrl: null, error: null };
}

export function revokeArtworkUrl(url: string | null | undefined): void {
  if (!url) return;
  if (url.startsWith("blob:")) {
    URL.revokeObjectURL(url);
  }
}

export async function readLocalArtworkFile(file: File): Promise<LocalArtworkState> {
  if (!file.type.startsWith("image/")) {
    return {
      status: "error",
      objectUrl: null,
      error: "Choose an image file (PNG, JPEG, WebP, or GIF).",
    };
  }
  if (file.size > MAX_BYTES) {
    return {
      status: "error",
      objectUrl: null,
      error: "Image is too large. Please choose a file under 8 MB.",
    };
  }

  const objectUrl = URL.createObjectURL(file);

  const valid = await new Promise<boolean>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = objectUrl;
  });

  if (!valid) {
    revokeArtworkUrl(objectUrl);
    return {
      status: "error",
      objectUrl: null,
      error: "That image could not be decoded. Prism will keep the placeholder art.",
    };
  }

  return { status: "ready", objectUrl, error: null };
}
