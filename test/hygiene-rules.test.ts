// Run: node test/hygiene-rules.test.ts
import assert from "node:assert/strict";
import { RULES, withRules } from "../extensions/hygiene-rules.ts";

const once = withRules("BASE");
assert.ok(once.startsWith("BASE\n\n## Project hygiene"));
assert.equal(withRules(once), once, "not appended twice");
assert.ok(RULES.length < 2000, `rules stay short (${RULES.length} chars)`);
console.log("hygiene-rules: all unit tests passed");
