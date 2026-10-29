import type { z } from "zod";

/** `pnpm ziki <command> [positional...] [--flag value | --flag=value | --bool]`. */
export type ParsedArgs = { positional: string[]; flags: Record<string, string[]> };

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--") || arg === "--") {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = toCamel(eq === -1 ? arg.slice(2) : arg.slice(2, eq));
    let value: string;
    if (eq !== -1) value = arg.slice(eq + 1);
    else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) value = argv[++i];
    else value = "true";
    (flags[name] ??= []).push(value);
  }
  return { positional, flags };
}

/** `project-id` → `projectId`; camelCase passes through. */
export function toCamel(name: string): string {
  return name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function toKebab(name: string): string {
  return name.replace(/_/g, "-").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** The schema field a flag names: `--device-code` matches `device_code` as well as `deviceCode`. */
function fieldFor(shape: z.ZodRawShape, flag: string): string | undefined {
  if (flag in shape) return flag;
  return Object.keys(shape).find((key) => toCamel(toKebab(key)) === flag);
}

type Def = { type: string; innerType?: z.ZodType; element?: z.ZodType; entries?: Record<string, string>; options?: z.ZodType[]; in?: z.ZodType; out?: z.ZodType; values?: unknown[] };

function defOf(schema: z.ZodType): Def {
  return (schema as unknown as { _zod: { def: Def } })._zod.def;
}

/** Peels optional/default/nullable wrappers off a field schema. */
export function baseSchema(schema: z.ZodType): { schema: z.ZodType; optional: boolean } {
  let current = schema;
  let optional = false;
  for (;;) {
    const def = defOf(current);
    if (def.type === "optional" || def.type === "default" || def.type === "nullable" || def.type === "prefault") {
      optional = true;
      current = def.innerType!;
    } else if (def.type === "pipe") {
      current = def.in!;
    } else {
      return { schema: current, optional };
    }
  }
}

/** A short type name for help text: string, number, boolean, a|b|c, string[], json. */
export function describeType(schema: z.ZodType): string {
  const { schema: base } = baseSchema(schema);
  const def = defOf(base);
  switch (def.type) {
    case "enum":
      return Object.values(def.entries ?? {}).join("|");
    case "literal":
      return (def.values ?? []).map(String).join("|");
    case "array":
      return `${describeType(def.element!)}[]`;
    case "string":
    case "number":
    case "boolean":
      return def.type;
    default:
      return "json";
  }
}

/** Turns one flag's raw strings into the value its schema expects. */
export function coerce(schema: z.ZodType, raw: string[], flag: string): unknown {
  const { schema: base } = baseSchema(schema);
  const def = defOf(base);
  const last = raw[raw.length - 1];
  switch (def.type) {
    case "number": {
      const value = Number(last);
      if (!Number.isFinite(value)) throw new CliUsageError(`--${toKebab(flag)} needs a number, got "${last}".`);
      return value;
    }
    case "boolean":
      if (last === "true" || last === "1" || last === "yes") return true;
      if (last === "false" || last === "0" || last === "no") return false;
      throw new CliUsageError(`--${toKebab(flag)} needs true or false, got "${last}".`);
    case "array": {
      const items = raw.flatMap((value) => (value.trim().startsWith("[") ? (parseJson(value, flag) as unknown[]) : value.split(",")));
      return items.map((item) => (typeof item === "string" ? coerce(def.element!, [item.trim()], flag) : item));
    }
    case "string":
    case "enum":
    case "literal":
      return last;
    default:
      return parseJsonOrString(last);
  }
}

function parseJson(value: string, flag: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new CliUsageError(`--${toKebab(flag)} needs JSON, got ${value}.`);
  }
}

function parseJsonOrString(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/**
 * The tool's input from flags. Unknown flags are an error, so a typo doesn't
 * silently send a request without the field. `globalFlags` are the CLI's own.
 */
export function toolInput(shape: z.ZodRawShape, flags: Record<string, string[]>, globalFlags: ReadonlySet<string>): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const [flag, raw] of Object.entries(flags)) {
    if (globalFlags.has(flag)) continue;
    const key = fieldFor(shape, flag);
    const field = key ? (shape[key] as z.ZodType) : undefined;
    if (!key || !field) {
      const known = Object.keys(shape).map((key) => `--${toKebab(key)}`).join(", ") || "none";
      throw new CliUsageError(`Unknown flag --${toKebab(flag)}. This command takes: ${known}.`);
    }
    input[key] = coerce(field, raw, flag);
  }
  return input;
}
