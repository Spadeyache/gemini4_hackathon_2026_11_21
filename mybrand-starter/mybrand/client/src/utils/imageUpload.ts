export const MAX_IMAGE_EDGE_PX = 1280;
export const JPEG_QUALITY = 0.82;
export const MAX_DIRECT_PNG_BYTES = 750 * 1024;

export interface EncodedIntakeImage {
  id: string;
  filename: string;
  mimeType: string;
  dataBase64: string;
  previewUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
}

export interface ScaledDimensions {
  width: number;
  height: number;
  resized: boolean;
}

export function computeScaledDimensions(
  naturalWidth: number,
  naturalHeight: number,
  maxEdge = MAX_IMAGE_EDGE_PX
): ScaledDimensions {
  const safeW = Math.max(1, Math.round(naturalWidth));
  const safeH = Math.max(1, Math.round(naturalHeight));
  const longest = Math.max(safeW, safeH);

  if (longest <= maxEdge) {
    return { width: safeW, height: safeH, resized: false };
  }

  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
    resized: true,
  };
}

export function stripDataUrlPrefix(dataUrl: string): string {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) return dataUrl;
  return dataUrl.slice(commaIdx + 1);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
      } else {
        reject(new Error(`Could not read ${file.name}`));
      }
    };
    reader.onerror = () => reject(new Error(`Failed reading ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function loadHtmlImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Unsupported or corrupt image file."));
    img.src = src;
  });
}

function canvasHasTransparency(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
): boolean {
  try {
    // Sample a small grid of pixels rather than scanning every single pixel
    const stepX = Math.max(1, Math.floor(width / 16));
    const stepY = Math.max(1, Math.floor(height / 16));
    const data = ctx.getImageData(0, 0, width, height).data;
    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const alpha = data[(y * width + x) * 4 + 3];
        if (alpha < 250) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

let imageCounter = 0;

export async function encodeImageFileForIntake(
  file: File
): Promise<EncodedIntakeImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error(`"${file.name}" is not a supported image file.`);
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadHtmlImage(rawDataUrl);
  const naturalW = img.naturalWidth || img.width || 512;
  const naturalH = img.naturalHeight || img.height || 512;

  const { width, height } = computeScaledDimensions(
    naturalW,
    naturalH,
    MAX_IMAGE_EDGE_PX
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Browser canvas unavailable for image compression.");
  }

  ctx.drawImage(img, 0, 0, width, height);

  const isPngOrWebp =
    file.type === "image/png" || file.type === "image/webp";
  const preservePng =
    isPngOrWebp &&
    (canvasHasTransparency(ctx, width, height) ||
      file.size <= MAX_DIRECT_PNG_BYTES);

  let mimeType = preservePng ? "image/png" : "image/jpeg";
  let encodedDataUrl = preservePng
    ? canvas.toDataURL("image/png")
    : canvas.toDataURL("image/jpeg", JPEG_QUALITY);

  // If PNG output is unexpectedly huge (> 1.4 MB base64), fall back to JPEG
  if (mimeType === "image/png" && encodedDataUrl.length > 1_900_000) {
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    mimeType = "image/jpeg";
    encodedDataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
  }

  const dataBase64 = stripDataUrlPrefix(encodedDataUrl);
  const sizeBytes = Math.round((dataBase64.length * 3) / 4);

  const baseFilename = file.name.replace(/\.[^.]+$/, "") || "photo";
  const ext = mimeType === "image/png" ? "png" : "jpg";
  imageCounter += 1;

  return {
    id: `img_local_${Date.now()}_${imageCounter}`,
    filename: `${baseFilename}.${ext}`,
    mimeType,
    dataBase64,
    previewUrl: encodedDataUrl,
    width,
    height,
    sizeBytes,
  };
}
