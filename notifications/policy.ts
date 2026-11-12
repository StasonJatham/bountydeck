import { createHmac } from "node:crypto";
import { BlockList, isIP } from "node:net";

export const notificationEvents = [
  "report.submitted",
  "report.status_changed",
  "report.comment_added",
  "report.severity_changed",
  "report.assigned",
  "report.validated",
  "report.resolved",
] as const;

export type NotificationEvent = (typeof notificationEvents)[number];

const blocked = new BlockList();
blocked.addSubnet("0.0.0.0", 8);
blocked.addSubnet("127.0.0.0", 8);
blocked.addSubnet("169.254.0.0", 16);
blocked.addSubnet("224.0.0.0", 3);
blocked.addAddress("::", "ipv6");
blocked.addAddress("::1", "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");
blocked.addSubnet("ff00::", 8, "ipv6");

function normalizedAddress(address: string) {
  const family = isIP(address);
  if (
    !family ||
    address.includes("%") ||
    blocked.check(address, family === 6 ? "ipv6" : "ipv4")
  ) {
    return undefined;
  }
  if (family === 4) return address;
  const normalized = new URL(`http://[${address}]`).hostname.slice(1, -1);
  return normalized.startsWith("::ffff:") ? undefined : normalized;
}

export function webhookUrl(value: string) {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    isIP(url.hostname) ||
    url.hostname.startsWith("[") ||
    !url.hostname.includes(".")
  ) {
    throw new Error(
      "Webhook requires an HTTPS hostname without credentials or fragment",
    );
  }
  return url;
}

export function parseWebhookDestinations(value = "{}") {
  const config: unknown = JSON.parse(value);
  if (typeof config !== "object" || config === null || Array.isArray(config)) {
    throw new Error("WEBHOOK_DESTINATIONS requires an origin-to-IP map");
  }
  const origins = new Map<string, Set<string>>();
  for (const [origin, addresses] of Object.entries(config)) {
    if (
      webhookUrl(origin).origin !== origin ||
      !Array.isArray(addresses) ||
      addresses.length === 0
    ) {
      throw new Error(
        "Webhook destination requires an exact origin and approved IPs",
      );
    }
    const pins = new Set<string>();
    for (const address of addresses) {
      const normalized =
        typeof address === "string" && normalizedAddress(address);
      if (!normalized)
        throw new Error("Webhook destination IP is invalid or prohibited");
      pins.add(normalized);
    }
    origins.set(origin, pins);
  }
  return origins;
}

export function approvedWebhook(
  value: string,
  origins: ReturnType<typeof parseWebhookDestinations>,
) {
  const url = webhookUrl(value);
  const pins = origins.get(url.origin);
  if (!pins) throw new Error("Webhook origin is not approved");
  return { url, pins };
}

export function approvedAddresses(
  answers: { address: string; family: number }[],
  pins: Set<string>,
) {
  return (
    answers.length > 0 &&
    answers.every(({ address, family }) => {
      const normalized = normalizedAddress(address);
      return (
        family === isIP(address) &&
        normalized !== undefined &&
        pins.has(normalized)
      );
    })
  );
}

export function validRecipient(address: string) {
  // Restrict to a single bare address. Nodemailer supports multi-address and
  // display-name syntax, which would bypass a one-recipient channel setting.
  return (
    address.length <= 254 &&
    /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(
      address,
    ) &&
    !address.includes("..") &&
    !address.startsWith(".") &&
    !address.includes(".@")
  );
}

export function signWebhook(secret: string, timestamp: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}
