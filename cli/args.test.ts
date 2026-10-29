import { describe, expect, it } from "vitest";
import { z } from "zod";
import { coerce, CliUsageError, describeType, parseArgs, toCamel, toKebab, toolInput } from "./args";

describe("parseArgs", () => {
  it("reads positionals, --flag value, --flag=value and bare flags", () => {
    expect(parseArgs(["get-issue", "--id", "abc", "--project-id=p1", "--unread"])).toEqual({
      positional: ["get-issue"],
      flags: { id: ["abc"], projectId: ["p1"], unread: ["true"] },
    });
  });

  it("collects repeated flags in order", () => {
    expect(parseArgs(["--events", "a", "--events", "b"]).flags.events).toEqual(["a", "b"]);
  });

  it("treats a bare flag followed by another flag as true", () => {
    expect(parseArgs(["--reset", "--server", "http://localhost:3001"]).flags).toEqual({ reset: ["true"], server: ["http://localhost:3001"] });
  });
});

describe("flag names", () => {
  it("convert between kebab-case flags and camelCase or snake_case fields", () => {
    expect(toCamel("pull-request-url")).toBe("pullRequestUrl");
    expect(toKebab("pullRequestUrl")).toBe("pull-request-url");
    expect(toKebab("device_code")).toBe("device-code");
  });
});

describe("coerce", () => {
  it("turns flag strings into numbers, booleans, arrays and JSON", () => {
    expect(coerce(z.number().int().optional(), ["7"], "limit")).toBe(7);
    expect(coerce(z.boolean(), ["no"], "unread")).toBe(false);
    expect(coerce(z.array(z.string()), ["a,b", "c"], "ids")).toEqual(["a", "b", "c"]);
    expect(coerce(z.array(z.number()), ["[1,2]"], "ids")).toEqual([1, 2]);
    expect(coerce(z.record(z.string(), z.unknown()), ['{"url":"x"}'], "data")).toEqual({ url: "x" });
    expect(coerce(z.string(), ["first", "last"], "title")).toBe("last");
  });

  it("refuses values that don't fit", () => {
    expect(() => coerce(z.number(), ["seven"], "limit")).toThrow(/--limit needs a number/);
    expect(() => coerce(z.boolean(), ["maybe"], "unread")).toThrow(CliUsageError);
    expect(() => coerce(z.array(z.number()), ["[1,"], "ids")).toThrow(/needs JSON/);
  });
});

describe("describeType", () => {
  it("names enums, arrays and wrapped types for help text", () => {
    expect(describeType(z.enum(["real", "fix"]))).toBe("real|fix");
    expect(describeType(z.array(z.string()).optional())).toBe("string[]");
    expect(describeType(z.string().trim().default("x"))).toBe("string");
    expect(describeType(z.object({ a: z.string() }))).toBe("json");
  });
});

describe("toolInput", () => {
  const shape = { id: z.string(), device_code: z.string().optional(), limit: z.number().optional() };

  it("maps flags onto the tool's fields and skips the CLI's own flags", () => {
    const input = toolInput(shape, { id: ["x"], deviceCode: ["d"], limit: ["3"], as: ["bob"] }, new Set(["as"]));
    expect(input).toEqual({ id: "x", device_code: "d", limit: 3 });
  });

  it("refuses an unknown flag and lists the ones the command takes", () => {
    expect(() => toolInput(shape, { colour: ["blue"] }, new Set())).toThrow(/Unknown flag --colour\. This command takes: --id, --device-code, --limit\./);
  });
});
