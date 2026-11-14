import { createHash } from "node:crypto";

export function personalKeyDigest(key: string) {
  return createHash("sha256").update(key).digest("hex");
}
