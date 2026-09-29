/**
 * Browser-only helpers for exports: PNG rasterization and downloads.
 *
 * @module lib/diagram/browser
 */

export function svgSize(svg: string): { width: number; height: number } | null {
  const match = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : null;
}

const MAX_PNG_WIDTH = 4800;

export async function rasterizeSvg(svg: string, scale = 2): Promise<{ blob: Blob; scale: number }> {
  const size = svgSize(svg);
  if (!size) throw new Error("The diagram has no size.");
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    await image.decode();
    // Embedded data: fonts load inside the image; give them a frame to apply.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    for (const attempt of scale > 1 ? [scale, 1] : [1]) {
      const factor = Math.min(attempt, MAX_PNG_WIDTH / size.width);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(size.width * factor);
      canvas.height = Math.round(size.height * factor);
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (blob) return { blob, scale: factor };
    }
    throw new Error("This browser could not create the PNG. Download the SVG instead.");
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
