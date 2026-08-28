/**
 * Coerces resource mapper values into the types expected by ROS messages.
 *
 * n8n's resource mapper stores manually entered field values as raw strings,
 * even for fields that a ROS message expects as numbers, booleans, arrays or
 * nested objects (e.g. the `data` field of `std_msgs/Float64MultiArray`).
 * Publishing those strings verbatim produces malformed messages.
 *
 * This helper looks at the `schema` that ships with the resource mapper value,
 * determines the intended type for each field, and parses the entered string
 * into that type. If a value cannot be parsed into the expected type, it throws
 * so the caller can abort before sending anything to ROS.
 */

import type { IExecuteFunctions, ResourceMapperField, ResourceMapperValue, FieldType } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

export type JsonRecord = Record<string, unknown>;

const RESOURCE_MAPPER_META_KEYS = new Set([
    'mappingMode',
    'value',
    'matchingColumns',
    'schema',
    'attemptToConvertTypes',
    'convertFieldsToString',
]);

export class ResourceMapperCoercer {
    /**
     * Turns a resource mapper parameter value into a plain message object,
     * parsing each field into the type declared in the mapper schema.
     *
     * @throws NodeOperationError if any value does not match its expected type
     */
    static coerceMessage(structure: unknown, ctx: IExecuteFunctions, itemIndex: number): JsonRecord {
        if (!structure || typeof structure !== 'object') {
            return {};
        }

        const mapper = structure as Partial<ResourceMapperValue> & Record<string, unknown>;

        // Backward-compat: a plain object without the `value` key (e.g. test
        // fixtures or a flattened structure). Strip mapper metadata and return.
        if (!('value' in mapper)) {
            const actualFields: JsonRecord = {};
            for (const [key, val] of Object.entries(mapper)) {
                if (!RESOURCE_MAPPER_META_KEYS.has(key)) {
                    actualFields[key] = val;
                }
            }
            return actualFields;
        }

        const value = mapper.value;
        if (!value || typeof value !== 'object') {
            return {};
        }

        const schemaByFieldId = new Map<string, ResourceMapperField>();
        for (const field of mapper.schema ?? []) {
            schemaByFieldId.set(field.id, field);
        }

        const message: JsonRecord = {};
        for (const [key, raw] of Object.entries(value)) {
            const field = schemaByFieldId.get(key);
            message[key] = this.coerceField(key, raw, field?.type, ctx, itemIndex);
        }
        return message;
    }

    private static coerceField(
        name: string,
        raw: unknown,
        type: FieldType | undefined,
        ctx: IExecuteFunctions,
        itemIndex: number,
    ): unknown {
        // Leave empty / unset values untouched; the field simply won't be sent.
        if (raw === null || raw === undefined) {
            return raw;
        }

        switch (type) {
            case 'number':
                return this.toNumber(name, raw, ctx, itemIndex);
            case 'boolean':
                return this.toBoolean(name, raw, ctx, itemIndex);
            case 'array':
                return this.toArray(name, raw, ctx, itemIndex);
            case 'object':
                return this.toObject(name, raw, ctx, itemIndex);
            default:
                // string-like types (string, dateTime, time, url, ...) or an
                // unknown field: send as entered.
                return raw;
        }
    }

    private static toNumber(name: string, raw: unknown, ctx: IExecuteFunctions, itemIndex: number): number {
        if (typeof raw === 'number' && !Number.isNaN(raw)) {
            return raw;
        }
        if (typeof raw === 'string') {
            const trimmed = raw.trim();
            if (trimmed !== '') {
                const parsed = Number(trimmed);
                if (!Number.isNaN(parsed)) {
                    return parsed;
                }
            }
        }
        throw this.mismatch(name, 'number', raw, ctx, itemIndex);
    }

    private static toBoolean(name: string, raw: unknown, ctx: IExecuteFunctions, itemIndex: number): boolean {
        if (typeof raw === 'boolean') {
            return raw;
        }
        if (typeof raw === 'string') {
            const normalized = raw.trim().toLowerCase();
            if (normalized === 'true') return true;
            if (normalized === 'false') return false;
        }
        throw this.mismatch(name, 'boolean', raw, ctx, itemIndex);
    }

    private static toArray(name: string, raw: unknown, ctx: IExecuteFunctions, itemIndex: number): unknown[] {
        if (Array.isArray(raw)) {
            return raw;
        }
        if (typeof raw === 'string') {
            const parsed = this.tryParseJson(name, raw, 'array', ctx, itemIndex);
            if (Array.isArray(parsed)) {
                return parsed;
            }
        }
        throw this.mismatch(name, 'array', raw, ctx, itemIndex);
    }

    private static toObject(name: string, raw: unknown, ctx: IExecuteFunctions, itemIndex: number): object {
        if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
            return raw;
        }
        if (typeof raw === 'string') {
            const parsed = this.tryParseJson(name, raw, 'object', ctx, itemIndex);
            if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        }
        throw this.mismatch(name, 'object', raw, ctx, itemIndex);
    }

    private static tryParseJson(
        name: string,
        raw: string,
        expected: FieldType,
        ctx: IExecuteFunctions,
        itemIndex: number,
    ): unknown {
        const trimmed = raw.trim();
        if (trimmed === '') {
            throw this.mismatch(name, expected, raw, ctx, itemIndex);
        }
        try {
            return JSON.parse(trimmed);
        } catch {
            throw this.mismatch(name, expected, raw, ctx, itemIndex);
        }
    }

    private static mismatch(
        name: string,
        expected: FieldType,
        raw: unknown,
        ctx: IExecuteFunctions,
        itemIndex: number,
    ): NodeOperationError {
        const received = typeof raw === 'string' ? JSON.stringify(raw) : String(raw);
        const example =
            expected === 'array' ? ' e.g. [0.5, 0.5, 0.6]' : expected === 'object' ? ' e.g. {"x": 1, "y": 2}' : '';
        return new NodeOperationError(
            ctx.getNode(),
            `Field "${name}" expects a value of type "${expected}", but received ${received}, which cannot be parsed into ${expected}.${example} Provide a valid ${expected} value (or an expression that resolves to one). The message was not sent.`,
            { itemIndex },
        );
    }
}
