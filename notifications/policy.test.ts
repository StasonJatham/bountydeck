import { describe, expect, it } from "vitest";
import {
  approvedAddresses,
  approvedWebhook,
  parseWebhookDestinations,
  signWebhook,
  validRecipient,
} from "./policy.ts";
import {
  buildPayload,
  classifyWebhook,
  createDeliveryTransport,
} from "./transport.ts";
import type { Delivery } from "./transport.ts";

const origins = parseWebhookDestinations(
  '{"https://hooks.internal":["10.0.0.5","fd01::1"]}',
);
const delivery = {
  id: "event-id",
  program_id: "program-id",
  report_id: "report-id",
  public_report_id: "BSO-42",
  event_type: "report.submitted",
  severity: null,
  created_at: new Date("2026-11-12T09:00:00Z"),
  enabled: true,
  destination: "https://hooks.internal/hook",
  signing_secret: "private signing secret",
  kind: "webhook",
} satisfies Delivery;

describe("notification policy", () => {
  it("requires an exact approved HTTPS origin", () => {
    expect(approvedWebhook(delivery.destination, origins).url.pathname).toBe(
      "/hook",
    );
    for (const endpoint of [
      "http://hooks.internal/hook",
      "https://hooks.internal:444/hook",
      "https://hooks.internal.attacker.invalid/hook",
      "https://hooks.internal@other.invalid/hook",
      "https://user:password@hooks.internal/hook",
      "https://10.0.0.5/hook",
      "https://hooks.internal/hook#fragment",
    ]) {
      expect(() => approvedWebhook(endpoint, origins)).toThrow();
    }
  });

  it("rejects any DNS answer outside the approved IP set", () => {
    const { pins } = approvedWebhook(delivery.destination, origins);
    const allowed = [{ address: "fd01:0:0:0:0:0:0:1", family: 6 }];
    expect(approvedAddresses(allowed, pins)).toBe(true);
    expect(approvedAddresses([], pins)).toBe(false);
    expect(
      approvedAddresses([...allowed, { address: "10.0.0.6", family: 4 }], pins),
    ).toBe(false);
    for (const address of [
      "127.0.0.1",
      "169.254.169.254",
      "::1",
      "::ffff:10.0.0.5",
    ]) {
      expect(() =>
        parseWebhookDestinations(
          JSON.stringify({ "https://hooks.internal": [address] }),
        ),
      ).toThrow();
    }
  });

  it("signs the exact serialized body and timestamp", () => {
    expect(
      signWebhook("secret", "1700000000", '{"event":"notification.test"}'),
    ).toBe(
      "sha256=0c3c19e2c2c1ab536143f27d299b1cba51cb8d63e94f367031b00793cb1408e9",
    );
  });

  it("limits outbound payload fields and preserves the stable event identifier", () => {
    expect(
      JSON.parse(
        JSON.stringify(buildPayload(delivery, new URL("https://app.internal"))),
      ),
    ).toEqual({
      event: "report.submitted",
      event_id: "event-id",
      timestamp: "2026-11-12T09:00:00.000Z",
      program_id: "program-id",
      report: {
        id: "BSO-42",
        severity: "pending",
        url: "https://app.internal/reports/report-id",
      },
    });
  });

  it("treats redirects as terminal and retries transient HTTP failures", () => {
    expect(classifyWebhook(204).status).toBe("delivered");
    expect(classifyWebhook(307).status).toBe("dead");
    expect(classifyWebhook(403).status).toBe("dead");
    expect(classifyWebhook(429).status).toBe("retry");
    expect(classifyWebhook(503).status).toBe("retry");
  });

  it("rejects unapproved and disabled channels before transport", async () => {
    const send = createDeliveryTransport({
      APP_ORIGIN: "https://app.internal",
    });
    await expect(send(delivery)).resolves.toEqual({
      status: "dead",
      result: "destination_denied",
    });
    await expect(send({ ...delivery, enabled: false })).resolves.toEqual({
      status: "dead",
      result: "channel_disabled",
    });
  });

  it("allows only a single bare SMTP recipient", () => {
    expect(validRecipient("team+test@internal.example")).toBe(true);
    expect(validRecipient("team@internal.example,other@outside.example")).toBe(
      false,
    );
    expect(
      validRecipient("team@internal.example\r\nBcc: other@outside.example"),
    ).toBe(false);
  });
});
