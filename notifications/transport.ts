import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { setTimeout } from "node:timers/promises";
import nodemailer from "nodemailer";
import {
  approvedAddresses,
  approvedWebhook,
  parseWebhookDestinations,
  signWebhook,
  validRecipient,
} from "./policy.ts";

export type DeliveryResult = {
  status: "delivered" | "retry" | "dead";
  result: string;
};

export type Delivery = {
  id: string;
  program_id: string;
  report_id: string | null;
  public_report_id: string | null;
  event_type: string;
  severity: string | null;
  created_at: Date;
  enabled: boolean;
  destination: string;
  signing_secret: string | null;
  kind: "smtp" | "webhook";
};

export function buildPayload(delivery: Delivery, origin: URL) {
  const report =
    delivery.report_id && delivery.public_report_id
      ? {
          id: delivery.public_report_id,
          severity: delivery.severity ?? "pending",
          url: new URL(
            `/reports/${encodeURIComponent(delivery.report_id)}`,
            origin,
          ).href,
        }
      : undefined;

  return {
    event: delivery.event_type,
    event_id: delivery.id,
    timestamp: delivery.created_at.toISOString(),
    program_id: delivery.program_id,
    report,
  };
}

function permanent(result: string): DeliveryResult {
  return { status: "dead", result };
}

export function classifyWebhook(status: number): DeliveryResult {
  const result = `http_${status}`;
  if (status >= 200 && status < 300) return { status: "delivered", result };
  if ([408, 425, 429].includes(status) || status >= 500)
    return { status: "retry", result };
  return permanent(result);
}

async function postWebhook(
  delivery: Delivery,
  body: string,
  origins: ReturnType<typeof parseWebhookDestinations>,
): Promise<DeliveryResult> {
  if (!delivery.signing_secret) return permanent("signing_secret_missing");
  let endpoint;
  try {
    endpoint = approvedWebhook(delivery.destination, origins);
  } catch {
    return permanent("destination_denied");
  }

  const { url, pins } = endpoint;
  const timeout = new AbortController();
  try {
    const answers = await Promise.race([
      lookup(url.hostname, { all: true }),
      setTimeout(3_000, null, { signal: timeout.signal }),
    ]);
    if (answers === null) return { status: "retry", result: "dns_timeout" };
    if (!approvedAddresses(answers, pins))
      return permanent("destination_dns_denied");

    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = signWebhook(delivery.signing_secret, timestamp, body);
    return await new Promise<DeliveryResult>((resolve, reject) => {
      const outgoing = request(
        {
          hostname: answers[0].address,
          port: url.port || 443,
          servername: url.hostname,
          path: url.pathname + url.search,
          method: "POST",
          agent: false,
          signal: AbortSignal.timeout(8_000),
          headers: {
            host: url.host,
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            "x-bossob-event-id": delivery.id,
            "x-bossob-timestamp": timestamp,
            "x-bossob-signature": signature,
          },
        },
        (response) => {
          response.destroy();
          resolve(classifyWebhook(response.statusCode ?? 502));
        },
      );
      outgoing.once("error", reject);
      outgoing.end(body);
    });
  } catch {
    return { status: "retry", result: "webhook_transport_error" };
  } finally {
    timeout.abort();
  }
}

function smtpTransport(value: string, allowPlaintext: boolean) {
  const url = URL.parse(value);
  if (
    !url ||
    !["smtp:", "smtps:"].includes(url.protocol) ||
    !url.hostname ||
    (url.pathname && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new Error("SMTP_URL requires an SMTP or SMTPS server URL");
  }
  const secure = url.protocol === "smtps:";
  return nodemailer.createTransport({
    host: url.hostname.replace(/^\[|\]$/g, ""),
    port: Number(url.port) || (secure ? 465 : 587),
    secure,
    requireTLS: !secure && !allowPlaintext,
    auth: url.username
      ? {
          user: decodeURIComponent(url.username),
          pass: decodeURIComponent(url.password),
        }
      : undefined,
    dnsTimeout: 3_000,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 8_000,
  });
}

export function createDeliveryTransport(
  env: Record<string, string | undefined>,
) {
  const origin = URL.parse(env.APP_ORIGIN ?? "");
  if (
    !origin ||
    !["https:", "http:"].includes(origin.protocol) ||
    origin.username ||
    origin.password ||
    origin.href !== `${origin.origin}/`
  ) {
    throw new Error("APP_ORIGIN requires an HTTP or HTTPS origin");
  }
  const approvedOrigins = parseWebhookDestinations(env.WEBHOOK_DESTINATIONS);
  const smtp = env.SMTP_URL
    ? smtpTransport(env.SMTP_URL, env.SMTP_ALLOW_PLAINTEXT === "true")
    : undefined;
  const from = env.SMTP_FROM;
  if (smtp && (!from || !validRecipient(from)))
    throw new Error("SMTP_FROM requires a bare email address");

  return async function send(delivery: Delivery): Promise<DeliveryResult> {
    if (!delivery.enabled) return permanent("channel_disabled");
    const payload = buildPayload(delivery, origin);
    if (delivery.kind === "webhook")
      return postWebhook(delivery, JSON.stringify(payload), approvedOrigins);

    if (!validRecipient(delivery.destination))
      return permanent("recipient_invalid");
    if (!smtp || !from) return permanent("smtp_unconfigured");

    try {
      const link = payload.report?.url;
      await smtp.sendMail({
        from,
        to: delivery.destination,
        subject: "Bug bounty activity",
        messageId: `<${delivery.id}@${origin.hostname}>`,
        text: link
          ? `Open the report in BountyDeck: ${link}`
          : "BountyDeck notification test.",
        html: link
          ? `<p><a href="${link}">Open the report in BountyDeck</a></p>`
          : "<p>BountyDeck notification test.</p>",
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      return { status: "delivered", result: "smtp_accepted" };
    } catch (error) {
      const code =
        error instanceof Error && "responseCode" in error
          ? Number(error.responseCode)
          : 0;
      return code >= 500 && code < 600
        ? permanent("smtp_rejected")
        : { status: "retry", result: "smtp_transport_error" };
    }
  };
}
