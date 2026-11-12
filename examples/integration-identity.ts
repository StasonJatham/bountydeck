export {};

async function main(): Promise<void> {
  const configuredOrigin = process.env.BOUNTYDECK_URL;
  const token = process.env.BOUNTYDECK_ACCESS_TOKEN;
  if (!configuredOrigin || !token) {
    throw new Error("Set BOUNTYDECK_URL and BOUNTYDECK_ACCESS_TOKEN.");
  }
  if (!/^[A-Za-z0-9._~+/-]+=*$/.test(token)) {
    throw new Error("Supply a bearer access token.");
  }

  const origin = URL.parse(configuredOrigin);
  const localHttp =
    origin?.protocol === "http:" && process.env.BOUNTYDECK_ALLOW_HTTP === "1";
  if (
    !origin ||
    (origin.protocol !== "https:" && !localHttp) ||
    origin.username ||
    origin.password ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash
  ) {
    throw new Error("Set BOUNTYDECK_URL to the deployment origin.");
  }

  const response = await fetch(new URL("/api/v1/identity", origin), {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  }).catch(() => {
    throw new Error("Could not reach the deployment's identity endpoint.");
  });
  if (!response.ok)
    throw new Error(`Identity request failed with HTTP ${response.status}.`);
  const identity: unknown = await response.json().catch(() => {
    throw new Error("The identity endpoint returned invalid JSON.");
  });
  console.log(JSON.stringify(identity, null, 2));
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Identity request failed.",
  );
  process.exitCode = 1;
});
