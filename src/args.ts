import { AxiError } from "axi-sdk-js";

export interface FlagDefinition {
  name: string;
  aliases?: string[];
  boolean?: boolean;
  repeatable?: boolean;
}

export interface ParsedArgs {
  positionals: string[];
  flags: Map<string, string | string[] | boolean>;
}

const REPO_FLAG: FlagDefinition = { name: "--repo", aliases: ["-R"] };

export function parseArgs(
  args: string[],
  definitions: FlagDefinition[],
  command: string,
): ParsedArgs {
  const defs = [...definitions, REPO_FLAG];
  const byFlag = new Map<string, FlagDefinition>();
  for (const def of defs) {
    byFlag.set(def.name, def);
    for (const alias of def.aliases ?? []) byFlag.set(alias, def);
  }

  const positionals: string[] = [];
  const flags = new Map<string, string | string[] | boolean>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith("-")) {
      positionals.push(arg);
      continue;
    }

    const equals = arg.indexOf("=");
    const rawName = equals === -1 ? arg : arg.slice(0, equals);
    const def = byFlag.get(rawName);
    if (!def) {
      throw usageError(
        `unknown flag ${rawName} for ${command}`,
        command,
        defs,
      );
    }

    if (def.boolean) {
      if (equals !== -1)
        throw usageError(`${rawName} does not take a value`, command, defs);
      if (flags.has(def.name))
        throw usageError(`${def.name} may only be given once`, command, defs);
      flags.set(def.name, true);
      continue;
    }

    const value =
      equals === -1
        ? args[++i]
        : arg.slice(equals + 1);
    if (value === undefined || value === "" || value.startsWith("-")) {
      throw usageError(`${rawName} requires a value`, command, defs);
    }

    if (def.repeatable) {
      const current = flags.get(def.name);
      flags.set(def.name, [...(Array.isArray(current) ? current : []), value]);
    } else {
      if (flags.has(def.name))
        throw usageError(`${def.name} may only be given once`, command, defs);
      flags.set(def.name, value);
    }
  }
  return { positionals, flags };
}

export function stripRepoFlag(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-R" || arg === "--repo") {
      i++;
      continue;
    }
    if (arg.startsWith("-R=") || arg.startsWith("--repo=")) continue;
    result.push(arg);
  }
  return result;
}

export function findRepoFlag(args: string[]): string | undefined {
  let value: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    let candidate: string | undefined;
    if (arg === "-R" || arg === "--repo") candidate = args[++i];
    else if (arg.startsWith("-R=")) candidate = arg.slice(3);
    else if (arg.startsWith("--repo=")) candidate = arg.slice(7);
    else continue;

    if (!candidate || candidate.startsWith("-"))
      throw new AxiError(`${arg} requires a value`, "VALIDATION_ERROR", [
        "Use `-R <workspace/repo>` or `--repo <workspace/repo>`",
      ]);
    if (value !== undefined)
      throw new AxiError("--repo may only be given once", "VALIDATION_ERROR");
    value = candidate;
  }
  return value;
}

export function stringFlag(parsed: ParsedArgs, name: string): string | undefined {
  const value = parsed.flags.get(name);
  return typeof value === "string" ? value : undefined;
}

export function stringFlags(parsed: ParsedArgs, name: string): string[] {
  const value = parsed.flags.get(name);
  return Array.isArray(value) ? value : [];
}

export function boolFlag(parsed: ParsedArgs, name: string): boolean {
  return parsed.flags.get(name) === true;
}

export function positiveInt(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100)
    throw new AxiError(`${flag} must be an integer from 1 to 100`, "VALIDATION_ERROR");
  return Number(value);
}

function usageError(
  message: string,
  command: string,
  definitions: FlagDefinition[],
): AxiError {
  const valid = definitions
    .map((def) => [...(def.aliases ?? []), def.name].join("/"))
    .join(", ");
  return new AxiError(message, "VALIDATION_ERROR", [
    `Valid flags: ${valid || "--help"} (--help always allowed)`,
    `Run \`${command} --help\``,
  ]);
}
