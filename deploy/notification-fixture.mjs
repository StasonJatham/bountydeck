// Test-only local receivers. Each event fails once before acceptance.
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer as httpsServer } from "node:https";
import { createServer as smtpServer } from "node:net";

const secret = readFileSync(
  "/run/secrets/notification_test_hmac",
  "utf8",
).trim();
const webhooks = new Set();
httpsServer(
  {
    key: readFileSync("/run/secrets/notification_test_key"),
    cert: readFileSync("/run/secrets/internal_ca"),
  },
  async (request, response) => {
    const buffers = [];
    for await (const chunk of request) buffers.push(chunk);
    const body = Buffer.concat(buffers).toString("utf8");
    const event = request.headers["x-bountydeck-event-id"];
    const timestamp = request.headers["x-bountydeck-timestamp"];
    const signature = createHmac("sha256", secret)
      .update(`${timestamp}.${body}`)
      .digest("hex");
    if (
      request.method !== "POST" ||
      request.url !== "/report" ||
      !event ||
      request.headers["x-bountydeck-signature"] !== `sha256=${signature}` ||
      !JSON.parse(body).report ||
      body.includes("Synthetic confidential report")
    ) {
      response.writeHead(400).end();
      return;
    }
    response.writeHead(webhooks.has(event) ? 204 : 503).end();
    webhooks.add(event);
  },
).listen(8443, "0.0.0.0");

const messages = new Set();
smtpServer((socket) => {
  socket.setEncoding("utf8");
  socket.write("220 BountyDeck test SMTP\r\n");
  let pending = "";
  let data = false;
  let event;
  socket.on("data", (chunk) => {
    pending += chunk;
    const lines = pending.split("\r\n");
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (data && line === ".") {
        socket.write(
          event && messages.has(event) ? "250 Accepted\r\n" : "451 Retry\r\n",
        );
        if (event) messages.add(event);
        data = false;
      } else if (data) {
        if (line.startsWith("Message-ID: ")) event = line;
      } else if (
        line.startsWith("RCPT TO:") &&
        !line.includes("browser-notification@example.invalid")
      ) {
        socket.write("550 Unknown fixture recipient\r\n");
      } else if (line === "DATA") {
        data = true;
        event = undefined;
        socket.write("354 Send message\r\n");
      } else if (line === "QUIT") {
        socket.end("221 Bye\r\n");
      } else {
        socket.write("250 OK\r\n");
      }
    }
  });
}).listen(2525, "0.0.0.0");
