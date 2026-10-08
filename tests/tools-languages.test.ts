import { describe, it, expect } from "vitest";
import { tool } from "@opencode-ai/plugin";
import {
  LANGUAGES,
  LANGUAGE_CHOICES,
  LANGUAGE_ARG_DESCRIPTION,
  PROJECT_ENV_ARG_DESCRIPTION,
  BUILD_ENV_ARG_DESCRIPTION,
} from "../src/tools/languages.js";

describe("project languages", () => {
  it("declares exactly the nine supported ids", () => {
    expect([...LANGUAGES]).toEqual([
      "node",
      "python",
      "go",
      "cpp",
      "c",
      "rust",
      "java",
      "ruby",
      "elixir",
    ]);
  });

  it("names every choice in the chooser text", () => {
    for (const id of LANGUAGES) {
      expect(LANGUAGE_CHOICES).toContain(id);
    }
    expect(LANGUAGE_ARG_DESCRIPTION).toContain(LANGUAGE_CHOICES);
  });

  it("tells the model where secrets belong", () => {
    expect(PROJECT_ENV_ARG_DESCRIPTION).toMatch(/never/i);
    expect(BUILD_ENV_ARG_DESCRIPTION).toMatch(/never stored/i);
  });

  it("builds a schema enum that accepts the nine and rejects the rest", () => {
    const schema = tool.schema.enum(LANGUAGES);
    for (const id of LANGUAGES) {
      expect(schema.safeParse(id).success).toBe(true);
    }
    expect(schema.safeParse("cobol").success).toBe(false);
    expect(schema.safeParse("").success).toBe(false);
  });

  it("builds a string-map schema for env", () => {
    const schema = tool.schema.record(tool.schema.string(), tool.schema.string());
    expect(schema.safeParse({ A: "1" }).success).toBe(true);
    expect(schema.safeParse({ A: 42 }).success).toBe(false);
    expect(schema.safeParse("nope").success).toBe(false);
  });
});
