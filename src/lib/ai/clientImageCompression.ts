/**
 * UAS Enterprise — Browser Canvas Image Compressor for Multimodal Vision Uploads
 *
 * Resizes high-resolution mobile camera / scanner images to max 1600px on the
 * longest edge at 0.82 JPEG quality before sending to `/api/ai/vision` or
 * `/api/ai/agent`, keeping field uploads lightweight and under payload caps.
 */

export interface CompressedVisionImage {
  base64Data: string;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  previewDataUrl: string;
  fileName: string;
  originalBytes: number;
  compressedBytes: number;
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("FILE_READ_FAILED"));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("IMAGE_DECODE_FAILED"));
    img.src = src;
  });
}

export async function compressImageFileForVision(
  file: File,
  opts: { maxDimension?: number; quality?: number } = {}
): Promise<CompressedVisionImage> {
  const maxDim = opts.maxDimension ?? 1600;
  const quality = opts.quality ?? 0.82;
  const dataUrl = await readFileAsDataUrl(file);
  const rawMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
  const fallbackMime =
    file.type === "image/png" || file.type === "image/webp"
      ? file.type
      : "image/jpeg";

  if (typeof document === "undefined") {
    return {
      base64Data: rawMatch?.[2] || "",
      mimeType: fallbackMime,
      previewDataUrl: dataUrl,
      fileName: file.name || "photo.jpg",
      originalBytes: file.size,
      compressedBytes: file.size,
    };
  }

  try {
    const img = await loadImageElement(dataUrl);
    const width = img.naturalWidth || img.width || 1200;
    const height = img.naturalHeight || img.height || 1200;
    const longest = Math.max(width, height);
    const scale = longest > maxDim ? maxDim / longest : 1;
    const targetW = Math.max(1, Math.round(width * scale));
    const targetH = Math.max(1, Math.round(height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return {
        base64Data: rawMatch?.[2] || "",
        mimeType: fallbackMime,
        previewDataUrl: dataUrl,
        fileName: file.name || "photo.jpg",
        originalBytes: file.size,
        compressedBytes: file.size,
      };
    }

    ctx.drawImage(img, 0, 0, targetW, targetH);
    const outputMime =
      fallbackMime === "image/webp" ? "image/webp" : "image/jpeg";
    const compressedUrl = canvas.toDataURL(outputMime, quality);
    const compressedBase64 = compressedUrl.split(",")[1] || rawMatch?.[2] || "";
    const compressedBytes = Math.floor((compressedBase64.length * 3) / 4);

    // Keep original if small PNG and compressed didn't shrink materially
    if (
      file.size < 450 * 1024 &&
      rawMatch?.[2] &&
      compressedBytes >= file.size
    ) {
      return {
        base64Data: rawMatch[2],
        mimeType: fallbackMime,
        previewDataUrl: dataUrl,
        fileName: file.name || "photo.jpg",
        originalBytes: file.size,
        compressedBytes: file.size,
      };
    }

    return {
      base64Data: compressedBase64,
      mimeType: outputMime,
      previewDataUrl: compressedUrl,
      fileName: file.name || "photo.jpg",
      originalBytes: file.size,
      compressedBytes,
    };
  } catch {
    return {
      base64Data: rawMatch?.[2] || "",
      mimeType: fallbackMime,
      previewDataUrl: dataUrl,
      fileName: file.name || "photo.jpg",
      originalBytes: file.size,
      compressedBytes: file.size,
    };
  }
}
