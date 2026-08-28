/**
 * Validates a message payload against the expanded definition of a ROS type.
 *
 * The resource mapper coercer ({@link ResourceMapperCoercer}) only parses the
 * top-level fields of a mapper value using n8n's coarse field types. This
 * validator goes further: given the fully expanded ROS type definition (from
 * `RosApiService.expandRootTypeDef`), it walks the payload recursively and:
 *   - parses numeric / boolean strings into their real types,
 *   - parses JSON strings into arrays / objects where the type expects them,
 *   - rejects unknown fields and values that cannot be coerced to the
 *     expected type.
 *
 * On any mismatch it throws a NodeOperationError naming the offending path and
 * the expected structure, so the caller aborts before sending anything to ROS.
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';
import type { ExpandedTypeDef } from '../services/RosApiService';

export type JsonRecord = Record<string, unknown>;

// A field value in an expanded type def can be a nested def or an array of
// them (for array fields). `ExpandedTypeDef` itself only covers the string /
// struct cases, so this union is what the recursive walk actually receives.
type Def = ExpandedTypeDef | ExpandedTypeDef[];

type LeafKind = 'number' | 'boolean' | 'string' | 'unknown';

export class MessageTypeValidator {
    /**
     * Validates and coerces `payload` against the expanded ROS type `def`.
     * Returns a new, coerced payload. Throws on any type mismatch.
     */
    static validate(payload: unknown, def: ExpandedTypeDef, ctx: IExecuteFunctions, itemIndex: number): JsonRecord {
        // The root path is empty; top-level fields render as "data" rather than
        // "message.data", and root-level errors fall back to "message".
        const result = this.validateNode(payload, def, '', ctx, itemIndex);
        // The root of a ROS message/service/action is always a struct.
        return (result ?? {}) as JsonRecord;
    }

    /**
     * Resolves the expanded ROS type via `fetchDef` and validates `payload`
     * against it. If the type cannot be introspected (rosapi unavailable,
     * custom type, etc.), validation is skipped and the payload is returned
     * unchanged. Validation mismatches still throw.
     */
    static async validateAgainstType(
        payload: JsonRecord,
        ctx: IExecuteFunctions,
        itemIndex: number,
        fetchDef: () => Promise<ExpandedTypeDef>,
    ): Promise<JsonRecord> {
        let def: ExpandedTypeDef;
        try {
            def = await fetchDef();
        } catch {
            // Type introspection failed — send the payload as-is.
            return payload;
        }
        if (!def || typeof def !== 'object') {
            return payload;
        }
        return this.validate(payload, def, ctx, itemIndex);
    }

    private static validateNode(
        value: unknown,
        def: Def,
        path: string,
        ctx: IExecuteFunctions,
        itemIndex: number,
    ): unknown {
        // Unset values are left to ROS defaults.
        if (value === null || value === undefined) {
            return value;
        }

        if (Array.isArray(def)) {
            return this.validateArray(value, def, path, ctx, itemIndex);
        }

        if (def !== null && typeof def === 'object') {
            return this.validateStruct(value, def, path, ctx, itemIndex);
        }

        // Leaf: def is a ROS primitive (or an unresolved nested type name).
        return this.validateLeaf(value, def, path, ctx, itemIndex);
    }

    private static validateArray(
        value: unknown,
        def: ExpandedTypeDef[],
        path: string,
        ctx: IExecuteFunctions,
        itemIndex: number,
    ): unknown[] {
        const arr = this.asArray(value, def, path, ctx, itemIndex);
        const innerDef = def[0];
        // A `[]`-only def (rare) means "array of unknown"; pass elements through.
        if (innerDef === undefined) {
            return arr;
        }
        return arr.map((element, index) => this.validateNode(element, innerDef, `${path}[${index}]`, ctx, itemIndex));
    }

    private static validateStruct(
        value: unknown,
        def: { [key: string]: ExpandedTypeDef | ExpandedTypeDef[] },
        path: string,
        ctx: IExecuteFunctions,
        itemIndex: number,
    ): JsonRecord {
        const obj = this.asObject(value, def, path, ctx, itemIndex);
        const result: JsonRecord = {};
        for (const [key, raw] of Object.entries(obj)) {
            const childPath = path ? `${path}.${key}` : key;
            if (!(key in def)) {
                throw this.error(
                    childPath,
                    `is not a field of this type. Allowed fields: ${Object.keys(def).join(', ') || '(none)'}`,
                    def,
                    ctx,
                    itemIndex,
                );
            }
            result[key] = this.validateNode(raw, def[key], childPath, ctx, itemIndex);
        }
        return result;
    }

    private static validateLeaf(
        value: unknown,
        rosType: string,
        path: string,
        ctx: IExecuteFunctions,
        itemIndex: number,
    ): unknown {
        switch (this.classifyLeaf(rosType)) {
            case 'number': {
                if (typeof value === 'number' && !Number.isNaN(value)) return value;
                if (typeof value === 'string' && value.trim() !== '') {
                    const parsed = Number(value.trim());
                    if (!Number.isNaN(parsed)) return parsed;
                }
                throw this.error(
                    path,
                    `expects a number (ROS type "${rosType}"), but received ${this.describe(value)}`,
                    rosType,
                    ctx,
                    itemIndex,
                );
            }
            case 'boolean': {
                if (typeof value === 'boolean') return value;
                if (typeof value === 'string') {
                    const normalized = value.trim().toLowerCase();
                    if (normalized === 'true') return true;
                    if (normalized === 'false') return false;
                }
                throw this.error(
                    path,
                    `expects a boolean (ROS type "${rosType}"), but received ${this.describe(value)}`,
                    rosType,
                    ctx,
                    itemIndex,
                );
            }
            case 'string': {
                if (typeof value === 'string') return value;
                throw this.error(
                    path,
                    `expects a string (ROS type "${rosType}"), but received ${this.describe(value)}`,
                    rosType,
                    ctx,
                    itemIndex,
                );
            }
            default:
                // Unresolved/opaque type (e.g. time/duration or a type rosapi
                // could not introspect): accept as-is.
                return value;
        }
    }

    private static asArray(
        value: unknown,
        def: Def,
        path: string,
        ctx: IExecuteFunctions,
        itemIndex: number,
    ): unknown[] {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
            const parsed = this.tryParseJson(value);
            if (Array.isArray(parsed)) return parsed;
        }
        throw this.error(path, `expects an array, but received ${this.describe(value)}`, def, ctx, itemIndex);
    }

    private static asObject(
        value: unknown,
        def: Def,
        path: string,
        ctx: IExecuteFunctions,
        itemIndex: number,
    ): JsonRecord {
        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
            return value as JsonRecord;
        }
        if (typeof value === 'string') {
            const parsed = this.tryParseJson(value);
            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed as JsonRecord;
            }
        }
        throw this.error(path, `expects an object, but received ${this.describe(value)}`, def, ctx, itemIndex);
    }

    private static classifyLeaf(rosType: string): LeafKind {
        const t = rosType.trim().toLowerCase();
        if (t === 'bool' || t === 'boolean') return 'boolean';
        if (t === 'string') return 'string';
        if (
            t === 'byte' ||
            t === 'char' ||
            t.startsWith('int') ||
            t.startsWith('uint') ||
            t.startsWith('float') ||
            t === 'double'
        ) {
            return 'number';
        }
        // time, duration, or any unresolved nested type name.
        return 'unknown';
    }

    private static tryParseJson(raw: string): unknown {
        const trimmed = raw.trim();
        if (trimmed === '') return undefined;
        try {
            return JSON.parse(trimmed);
        } catch {
            return undefined;
        }
    }

    private static describe(value: unknown): string {
        if (typeof value === 'string') return `the string ${JSON.stringify(value)}`;
        if (Array.isArray(value)) return 'an array';
        if (value !== null && typeof value === 'object') return 'an object';
        return String(value);
    }

    private static error(
        path: string,
        problem: string,
        def: Def,
        ctx: IExecuteFunctions,
        itemIndex: number,
    ): NodeOperationError {
        let structure = JSON.stringify(def);
        if (structure.length > 500) {
            structure = `${structure.slice(0, 500)}…`;
        }
        return new NodeOperationError(
            ctx.getNode(),
            `Message payload does not match the ROS type: "${path || 'message'}" ${problem}. Expected structure here: ${structure}. The message was not sent.`,
            { itemIndex },
        );
    }
}
