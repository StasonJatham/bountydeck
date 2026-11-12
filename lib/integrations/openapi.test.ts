import SwaggerParser from "@apidevtools/swagger-parser";
import type { OpenAPIV3_1 } from "openapi-types";
import { expect, test } from "vitest";
import { openApi } from "./openapi";
import { operations } from "./operations";

test("generated OpenAPI validates and contains every registered operation", async () => {
  const spec = openApi();
  await SwaggerParser.validate(spec as unknown as OpenAPIV3_1.Document);
  const operationIds = Object.values(spec.paths).flatMap((path) =>
    Object.values(path).map(
      (entry) => (entry as { operationId: string }).operationId,
    ),
  );
  expect(new Set(operationIds).size).toBe(operations.length);
  expect(operationIds.sort()).toEqual(
    operations.map(({ name }) => name).sort(),
  );
});
