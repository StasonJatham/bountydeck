export function requiredTestEnv(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Set ${name} for the integration tests. See TESTING.md.`);
  return value;
}
