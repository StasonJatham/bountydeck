import { CVSS40 } from "@pandatix/js-cvss";

export function cvssScore(vector: string) {
  if (vector.length > 512 || !vector.startsWith("CVSS:4.0/")) return null;
  try {
    const result = new CVSS40(vector).Score();
    return Number.isFinite(result) && result >= 0 && result <= 10
      ? result
      : null;
  } catch {
    return null;
  }
}
