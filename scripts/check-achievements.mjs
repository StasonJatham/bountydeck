import { readFileSync, readdirSync } from "node:fs";
import assert from "node:assert/strict";
import Ajv from "ajv/dist/2020.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const catalog = JSON.parse(read("../lib/achievements/catalog.json"));
const schema = JSON.parse(read("../lib/achievements/catalog.schema.json"));
const validate = new Ajv().compile(schema);
assert(validate(catalog), JSON.stringify(validate.errors));

const thresholdRules = new Set([
  "validated_reports",
  "validated_reports_min_severity",
  "validated_reports_exact_severity_critical",
  "distinct_validated_severity_bands",
  "lifetime_points",
  "distinct_programs_with_validated_reports",
  "distinct_org_units_with_validated_reports",
  "distinct_cwe_in_validated_reports",
  "triager_verified_repro_count",
  "distinct_months_with_validated_reports",
  "distinct_seasons_with_validated_reports",
]);
const svgDirectory = new URL("../public/achievements/svg/", import.meta.url);
const ids = new Set();
assert.equal(catalog.badges.length, 30);
for (const badge of catalog.badges) {
  assert(!ids.has(badge.id), `Duplicate badge ID: ${badge.id}`);
  ids.add(badge.id);
  assert.equal(badge.asset, `svg/${badge.id}.svg`);
  assert.equal(badge.requires_opt_in_to_publish, true);

  const { type, threshold, period, max_rank: maxRank } = badge.rule;
  assert.equal(badge.repeatable, type === "final_season_rank");
  if (thresholdRules.has(type)) {
    assert(Number.isSafeInteger(threshold) && threshold > 0, badge.id);
    assert.equal(period, undefined, badge.id);
    assert.equal(maxRank, undefined, badge.id);
  } else if (type === "final_season_rank") {
    assert(["quarter", "year"].includes(period), badge.id);
    assert(Number.isSafeInteger(maxRank) && maxRank > 0, badge.id);
    assert.equal(threshold, undefined, badge.id);
  } else {
    assert.deepEqual(badge.rule, { type: "manual_award" }, badge.id);
  }

  const svg = read(`../public/achievements/${badge.asset}`);
  assert.match(svg, /^<svg\b[^>]*viewBox="0 0 192 192"/);
  assert.doesNotMatch(
    svg,
    /<!|<\?|\b(?:href|src|style|on\w+)\s*=|url\(\s*[^#]/i,
  );
  for (const [, tag] of svg.matchAll(/<\/?([\w:-]+)/g)) {
    assert(
      [
        "svg",
        "title",
        "desc",
        "defs",
        "linearGradient",
        "stop",
        "path",
        "circle",
        "ellipse",
        "g",
        "rect",
      ].includes(tag),
      `Unexpected element ${tag} in ${badge.asset}`,
    );
  }
}
assert.deepEqual(
  readdirSync(svgDirectory).sort(),
  [...ids].sort().map((id) => `${id}.svg`),
);

// Each catalog version has an immutable database seed. Check it against the
// catalog used by the UI and API so the award rules cannot drift.
const seed = read("../db/migrations/0012_achievements.sql");
const rows = [
  ...seed.matchAll(/\('([a-z0-9-]+)', '(\{[^\n]+\})'::jsonb, (\d+)\)/g),
];
assert.deepEqual(
  rows.map(([, id, rule, version]) => ({
    id,
    rule: JSON.parse(rule),
    version: Number(version),
  })),
  catalog.badges.map(({ id, rule }) => ({
    id,
    rule,
    version: catalog.catalog_version,
  })),
);
