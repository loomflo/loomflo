import { z } from "zod";
import type { ToolDefinition } from "../types.js";

// ============================================================================
// ToolContext
// ============================================================================

/**
 * Execution context passed to a tool when invoked by an agent.
 *
 * Provides the tool with workspace location, caller identity, and
 * write permission boundaries so it can enforce security constraints.
 */
export interface ToolContext {
  /** Absolute path to the project workspace root. */
  workspacePath: string;
  /** ID of the agent invoking this tool. */
  agentId: string;
  /** ID of the workflow node the invoking agent belongs to. */
  nodeId: string;
  /** Glob patterns defining which files the agent is allowed to write. */
  writeScope: string[];
}

// ============================================================================
// Tool
// ============================================================================

/**
 * Interface for an executable tool available to agents.
 *
 * Tools are the primary mechanism for agents to interact with the outside
 * world (filesystem, shell, HTTP, etc.). Each tool declares its name,
 * description, and input schema (used for validation and LLM prompt
 * generation). The execute method MUST return a result string on success
 * or an error description string on failure — it MUST NEVER throw.
 */
export interface Tool {
  /** Unique tool identifier (e.g., "read_file", "write_file", "shell_exec"). */
  readonly name: string;
  /** Human-readable description included in the LLM system prompt. */
  readonly description: string;
  /** Zod schema used to validate tool input before execution. */
  readonly inputSchema: z.ZodType<unknown>;
  /**
   * Execute the tool with validated input.
   *
   * @param input - The raw input from the LLM, validated against inputSchema before calling.
   * @param context - Execution context with workspace path, agent identity, and write scope.
   * @returns A string describing the result on success or the error on failure.
   *   This method MUST NEVER throw — all errors are returned as descriptive strings.
   */
  execute(input: unknown, context: ToolContext): Promise<string>;
}

// ============================================================================
// zodToJsonSchema
// ============================================================================

/** JSON Schema property descriptor. */
interface JsonSchemaProperty {
  type?: string;
  description?: string;
  enum?: unknown[];
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  oneOf?: JsonSchema[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  nullable?: boolean;
}

/** JSON Schema object representation. */
type JsonSchema = JsonSchemaProperty & Record<string, unknown>;

/**
 * Convert a Zod schema to a JSON Schema object.
 *
 * Supports the subset of Zod types commonly used in tool input schemas:
 * string, number, boolean, object, array, enum, union, literal, optional,
 * nullable, and default. Unrecognized types fall back to an empty schema
 * (accepts any value).
 *
 * @param schema - The Zod schema to convert.
 * @returns A JSON Schema object suitable for serialization.
 */
export function zodToJsonSchema(schema: z.ZodType<unknown>): Record<string, unknown> {
  return processSchema(schema);
}

/**
 * Recursively process a Zod schema into a JSON Schema object.
 *
 * @param schema - The Zod schema node to process.
 * @returns The corresponding JSON Schema representation.
 */
function processSchema(schema: z.ZodType<unknown>): JsonSchema {
  const def = schema._def as Record<string, unknown>;
  const typeName = def["typeName"] as string | undefined;

  switch (typeName) {
    case "ZodString":
      return processString(def);
    case "ZodNumber":
      return processNumber(def);
    case "ZodBoolean":
      return { type: "boolean" };
    case "ZodObject":
      return processObject(def);
    case "ZodArray":
      return processArray(def);
    case "ZodEnum":
      return processEnum(def);
    case "ZodNativeEnum":
      return processNativeEnum(def);
    case "ZodLiteral":
      return processLiteral(def);
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return processUnion(def);
    case "ZodOptional":
      return processSchema(def["innerType"] as z.ZodType<unknown>);
    case "ZodNullable":
      return { ...processSchema(def["innerType"] as z.ZodType<unknown>), nullable: true };
    case "ZodDefault":
      return processDefault(def);
    case "ZodRecord":
      return processRecord(def);
    case "ZodEffects":
      return processSchema(def["schema"] as z.ZodType<unknown>);
    default:
      return {};
  }
}

/**
 * Process a ZodString into JSON Schema.
 *
 * @param def - The Zod internal definition.
 * @returns JSON Schema for a string type.
 */
function processString(def: Record<string, unknown>): JsonSchema {
  const result: JsonSchema = { type: "string" };
  const checks = def["checks"] as Array<Record<string, unknown>> | undefined;
  if (checks) {
    for (const check of checks) {
      if (check["kind"] === "min") result["minLength"] = check["value"] as number;
      if (check["kind"] === "max") result["maxLength"] = check["value"] as number;
      if (check["kind"] === "regex") result["pattern"] = String(check["regex"]);
    }
  }
  return result;
}

/**
 * Process a ZodNumber into JSON Schema.
 *
 * @param def - The Zod internal definition.
 * @returns JSON Schema for a number type.
 */
function processNumber(def: Record<string, unknown>): JsonSchema {
  const checks = def["checks"] as Array<Record<string, unknown>> | undefined;
  const result: JsonSchema = { type: "number" };
  if (checks) {
    for (const check of checks) {
      if (check["kind"] === "int") result["type"] = "integer";
      if (check["kind"] === "min") result["minimum"] = check["value"] as number;
      if (check["kind"] === "max") result["maximum"] = check["value"] as number;
    }
  }
  return result;
}

/**
 * Process a ZodObject into JSON Schema.
 *
 * @param def - The Zod internal definition.
 * @returns JSON Schema for an object type with properties and required fields.
 */
function processObject(def: Record<string, unknown>): JsonSchema {
  const shape = def["shape"] as (() => Record<string, z.ZodType<unknown>>) | undefined;
  if (!shape) return { type: "object" };

  const shapeObj = shape();
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shapeObj)) {
    properties[key] = processSchema(value);
    if (!isOptional(value)) {
      required.push(key);
    }
  }

  const result: JsonSchema = { type: "object", properties, additionalProperties: false };
  if (required.length > 0) {
    result["required"] = required;
  }
  return result;
}

/**
 * Check whether a Zod schema represents an optional field.
 *
 * @param schema - The Zod schema to inspect.
 * @returns True if the schema is optional or has a default value.
 */
function isOptional(schema: z.ZodType<unknown>): boolean {
  const def = schema._def as Record<string, unknown>;
  const typeName = def["typeName"] as string | undefined;
  if (typeName === "ZodOptional" || typeName === "ZodDefault") return true;
  return false;
}

/**
 * Process a ZodArray into JSON Schema.
 *
 * @param def - The Zod internal definition.
 * @returns JSON Schema for an array type.
 */
function processArray(def: Record<string, unknown>): JsonSchema {
  const itemType = def["type"] as z.ZodType<unknown> | undefined;
  const result: JsonSchema = { type: "array" };
  if (itemType) {
    result["items"] = processSchema(itemType);
  }
  return result;
}

/**
 * Process a ZodEnum into JSON Schema.
 *
 * @param def - The Zod internal definition.
 * @returns JSON Schema with enum values.
 */
function processEnum(def: Record<string, unknown>): JsonSchema {
  const values = def["values"] as unknown[];
  return { type: "string", enum: values };
}

/**
 * Process a ZodNativeEnum into JSON Schema.
 *
 * @param def - The Zod internal definition.
 * @returns JSON Schema with enum values from a TypeScript enum.
 */
function processNativeEnum(def: Record<string, unknown>): JsonSchema {
  const enumObj = def["values"] as Record<string, unknown>;
  const values = Object.values(enumObj).filter(
    (v) => typeof v === "string" || typeof v === "number",
  );
  return { enum: values };
}

/**
 * Process a ZodLiteral into JSON Schema.
 *
 * @param def - The Zod internal definition.
 * @returns JSON Schema with a const/enum value.
 */
function processLiteral(def: Record<string, unknown>): JsonSchema {
  const value = def["value"];
  return { enum: [value] };
}

/**
 * Process a ZodUnion or ZodDiscriminatedUnion into JSON Schema.
 *
 * @param def - The Zod internal definition.
 * @returns JSON Schema with oneOf variants.
 */
function processUnion(def: Record<string, unknown>): JsonSchema {
  const options = def["options"] as z.ZodType<unknown>[];
  return { oneOf: options.map((opt) => processSchema(opt)) };
}

/**
 * Process a ZodDefault into JSON Schema, preserving the default value.
 *
 * @param def - The Zod internal definition.
 * @returns JSON Schema with the default value applied.
 */
function processDefault(def: Record<string, unknown>): JsonSchema {
  const innerSchema = processSchema(def["innerType"] as z.ZodType<unknown>);
  const defaultValueFn = def["defaultValue"] as (() => unknown) | undefined;
  if (defaultValueFn) {
    innerSchema["default"] = defaultValueFn();
  }
  return innerSchema;
}

/**
 * Process a ZodRecord into JSON Schema.
 *
 * @param def - The Zod internal definition.
 * @returns JSON Schema for an object with dynamic keys.
 */
function processRecord(def: Record<string, unknown>): JsonSchema {
  const valueType = def["valueType"] as z.ZodType<unknown> | undefined;
  const result: JsonSchema = { type: "object" };
  if (valueType) {
    result["additionalProperties"] = processSchema(valueType);
  }
  return result;
}

// ============================================================================
// toToolDefinition
// ============================================================================

/**
 * Convert a {@link Tool} to a JSON-serializable {@link ToolDefinition}.
 *
 * Extracts the tool's name and description, and converts its Zod input
 * schema to a JSON Schema object suitable for sending to an LLM provider.
 *
 * @param tool - The tool to convert.
 * @returns A ToolDefinition with name, description, and JSON Schema inputSchema.
 */
export function toToolDefinition(tool: Tool): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.inputSchema),
  };
}
