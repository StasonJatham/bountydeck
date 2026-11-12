"use client";

import { useState } from "react";

export function RequestRunner({ operations }: { operations: string[] }) {
  const [response, setResponse] = useState("");
  const [running, setRunning] = useState(false);
  return (
    <form
      className="grid gap-3 rounded-lg border border-line bg-surface p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const [method, template] = String(form.get("operation")).split(" ");
        const values = String(form.get("pathParams"))
          .split(",")
          .map((part) => part.trim());
        let index = 0;
        const route = template.replace(/\{[^}]+\}/g, () =>
          encodeURIComponent(values[index++] ?? ""),
        );
        const query = new URLSearchParams(String(form.get("query")));
        const token = String(form.get("token")).trim();
        setRunning(true);
        setResponse("");
        try {
          const result = await fetch(`/api/v1${route}?${query}`, {
            method,
            redirect: "error",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            ...(method !== "GET"
              ? { body: String(form.get("body")) || "{}" }
              : {}),
          });
          const content = result.headers.get("content-type")?.includes("json")
            ? await result.text()
            : "(binary response)";
          setResponse(`HTTP ${result.status}\n${content}`);
        } catch {
          setResponse("The request could not be completed.");
        } finally {
          setRunning(false);
        }
      }}
    >
      <label className="grid gap-1">
        Operation
        <select
          name="operation"
          className="rounded-md border border-control p-2"
        >
          {operations.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        Access token
        <input
          type="password"
          name="token"
          autoComplete="off"
          required
          className="rounded-md border border-control p-2"
        />
      </label>
      <label className="grid gap-1">
        Path parameter values, in order
        <input
          name="pathParams"
          className="rounded-md border border-control p-2"
        />
      </label>
      <label className="grid gap-1">
        Query string
        <input
          name="query"
          placeholder="limit=10"
          className="rounded-md border border-control p-2"
        />
      </label>
      <label className="grid gap-1">
        JSON body
        <textarea
          name="body"
          rows={4}
          className="rounded-md border border-control p-2 font-mono"
        />
      </label>
      <button
        disabled={running}
        className="w-fit rounded-md bg-action px-4 py-2 text-on-action"
      >
        {running ? "Sending…" : "Send request"}
      </button>
      {response && (
        <pre
          aria-live="polite"
          className="max-h-96 overflow-auto rounded-md bg-subtle p-3 text-xs"
        >
          {response}
        </pre>
      )}
    </form>
  );
}
