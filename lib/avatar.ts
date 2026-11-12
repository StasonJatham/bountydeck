import sharp from "sharp";

const maxBytes = 1024 * 1024;

export async function encodeAvatar(file: File) {
  if (!file.size || file.size > maxBytes) return null;
  const bytes = Buffer.from(await file.arrayBuffer());
  const header = bytes.toString("ascii", 0, 6);
  const format =
    header === "GIF87a" || header === "GIF89a"
      ? "gif"
      : bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
        ? "png"
        : bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"))
          ? "jpeg"
          : null;
  if (!format) return null;

  try {
    const image = sharp(bytes, {
      animated: format === "gif",
      failOn: "warning",
      limitInputPixels: 4_194_304,
    });
    const info = await image.metadata();
    const frames = info.pages ?? 1;
    const height = info.pageHeight ?? info.height;
    if (
      info.format !== format ||
      frames > 60 ||
      info.width > 512 ||
      height > 512 ||
      info.width * height * frames > 4_194_304
    )
      return null;

    const encoded = await image
      .autoOrient()
      .resize(256, 256, { fit: "inside", withoutEnlargement: true })
      .webp({ effort: 0 })
      .timeout({ seconds: 3 })
      .toBuffer();
    return encoded.length <= maxBytes ? encoded : null;
  } catch {
    return null;
  }
}
