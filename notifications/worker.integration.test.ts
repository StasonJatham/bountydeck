import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { setTimeout } from "node:timers/promises";
import pg from "pg";
import { expect, it } from "vitest";

const adminUrl = process.env.TEST_NOTIFICATION_ADMIN_URL;
const workerUrl = process.env.TEST_NOTIFICATION_WORKER_URL;

it.skipIf(!adminUrl || !workerUrl)(
  "claims SMTP work concurrently, records a transient failure, then delivers the same event",
  async () => {
    const received: string[] = [];
    const server = createServer((socket) => {
      socket.setEncoding("utf8");
      socket.write("220 localhost SMTP test fixture\r\n");
      let pending = "";
      let message: string[] | undefined;
      socket.on("data", (chunk: string) => {
        pending += chunk;
        const lines = pending.split("\r\n");
        pending = lines.pop() ?? "";
        for (const line of lines) {
          if (message) {
            if (line === ".") {
              received.push(message.join("\r\n"));
              message = undefined;
              socket.write(
                received.length === 1
                  ? "451 Try again\r\n"
                  : "250 Accepted\r\n",
              );
            } else {
              message.push(line);
            }
          } else if (line === "DATA") {
            message = [];
            socket.write("354 Send message\r\n");
          } else if (line === "QUIT") {
            socket.end("221 Bye\r\n");
          } else {
            socket.write("250 OK\r\n");
          }
        }
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("No SMTP fixture port");

    const database = new pg.Client({ connectionString: adminUrl });
    await database.connect();
    const [org, program, channel, job] = Array.from({ length: 4 }, () =>
      randomUUID(),
    );
    const workers = Array.from({ length: 2 }, () =>
      spawn(
        process.execPath,
        ["--experimental-strip-types", "notifications/worker.ts"],
        {
          env: {
            ...process.env,
            APP_ORIGIN: "http://bossob.test",
            WORKER_DATABASE_URL: workerUrl,
            SMTP_URL: `smtp://127.0.0.1:${address.port}`,
            SMTP_FROM: "fixture@internal.example",
            SMTP_ALLOW_PLAINTEXT: "true",
            WEBHOOK_DESTINATIONS: "{}",
            NOTIFICATION_MAX_ATTEMPTS: "3",
          },
          stdio: "ignore",
        },
      ),
    );

    async function waitForAttempts(attempts: number) {
      for (let i = 0; i < 60; i++) {
        const {
          rows: [item],
        } = await database.query<{
          attempts: number;
          status: string;
          available_at: Date;
        }>(
          "SELECT attempts, status, available_at FROM notification_outbox WHERE id = $1",
          [job],
        );
        if (item.attempts >= attempts) return item;
        await setTimeout(100);
      }
      throw new Error(`Worker did not reach ${attempts} attempts`);
    }

    try {
      await database.query(
        "INSERT INTO org_units (id,name,slug) VALUES ($1::uuid,'Test',$1::text)",
        [org],
      );
      await database.query(
        "INSERT INTO programs (id,org_id,name,slug) VALUES ($1::uuid,$2,'Test',$1::text)",
        [program, org],
      );
      await database.query(
        "INSERT INTO notification_channels (id,program_id,kind,destination) VALUES ($1,$2,'smtp','fixture@internal.example')",
        [channel, program],
      );
      await database.query(
        "INSERT INTO notification_outbox (id,program_id,channel_id,event_type) VALUES ($1,$2,$3,'notification.test')",
        [job, program, channel],
      );

      const first = await waitForAttempts(1);
      expect(first.status).toBe("pending");
      expect(first.available_at.getTime()).toBeGreaterThan(Date.now());
      await database.query(
        "UPDATE notification_outbox SET available_at = now() WHERE id = $1",
        [job],
      );
      expect(await waitForAttempts(2)).toMatchObject({
        status: "delivered",
        attempts: 2,
      });

      const history = await database.query(
        "SELECT attempt, result FROM notification_deliveries WHERE outbox_id = $1 ORDER BY attempt",
        [job],
      );
      expect(history.rows).toEqual([
        { attempt: 1, result: "smtp_transport_error" },
        { attempt: 2, result: "smtp_accepted" },
      ]);
      expect(received).toHaveLength(2);
      for (const message of received)
        expect(message).toContain(`Message-ID: <${job}@bossob.test>`);
    } finally {
      await Promise.all(
        workers.map(async (worker) => {
          if (worker.exitCode === null && worker.signalCode === null) {
            const exit = once(worker, "exit");
            worker.kill();
            await exit;
          }
        }),
      );
      server.close();
      await database.query(
        "DELETE FROM notification_deliveries WHERE outbox_id = $1",
        [job],
      );
      await database.query("DELETE FROM notification_outbox WHERE id = $1", [
        job,
      ]);
      await database.query("DELETE FROM notification_channels WHERE id = $1", [
        channel,
      ]);
      await database.query("DELETE FROM programs WHERE id = $1", [program]);
      await database.query("DELETE FROM org_units WHERE id = $1", [org]);
      await database.end();
    }
  },
  20_000,
);
