import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

import { DESCRIPTION } from "../src/cli.js";
import { createSkillMarkdown } from "../src/skill.js";

describe("skill", () => {
  it("is generated for the Data Center CLI", () => {
    const skill = createSkillMarkdown();
    expect(skill.startsWith("---\nname: bitbucket-dc-axi\n")).toBe(true);
    expect(skill).toContain(DESCRIPTION);
    expect(skill).not.toContain("bitbucket-axi ");
    expect(skill).not.toContain("Bitbucket Cloud");
    expect(skill).not.toContain("--email");
  });

  it("matches the committed skill file", () => {
    const out = execFileSync("node_modules/.bin/tsx", ["scripts/build-skill.ts", "--check"], {
      encoding: "utf8",
    });
    expect(out).toContain("skills/bitbucket-dc-axi/SKILL.md is up to date.");
  });
});
