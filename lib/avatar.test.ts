import sharp from "sharp";
import { expect, test } from "vitest";
import { encodeAvatar } from "./avatar";

const animatedGif = Buffer.from(
  "R0lGODlhAQABAPAAAP8AAAAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQADAAAACwAAAAAAQABAAACAkQBACH5BAAMAAAALAAAAAABAAEAgAAA/wAAAAICRAEAOw==",
  "base64",
);

test("re-encodes GIFs with animation intact and rejects invalid or oversized images", async () => {
  const avatar = await encodeAvatar(new File([animatedGif], "avatar.gif"));
  expect(avatar).not.toBeNull();
  expect(await sharp(avatar!, { animated: true }).metadata()).toMatchObject({
    format: "webp",
    pages: 2,
    delay: [120, 120],
  });
  const oversized = await sharp({
    create: { width: 513, height: 1, channels: 3, background: "white" },
  })
    .png()
    .toBuffer();
  for (const bytes of [
    Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"),
    animatedGif.subarray(0, 10),
    Buffer.alloc(1024 * 1024 + 1),
    oversized,
  ]) {
    expect(
      await encodeAvatar(
        new File([new Uint8Array(bytes)], "avatar.gif", {
          type: "image/gif",
        }),
      ),
    ).toBeNull();
  }
});
