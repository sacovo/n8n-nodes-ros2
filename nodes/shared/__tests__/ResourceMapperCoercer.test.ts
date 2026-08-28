/**
 * Unit tests for ResourceMapperCoercer utility
 */

import { ResourceMapperCoercer } from '../utils/ResourceMapperCoercer';
import type { IExecuteFunctions, ResourceMapperField, FieldType } from 'n8n-workflow';

const ctx = {
    getNode: () => ({ name: 'Test Node' }),
} as unknown as IExecuteFunctions;

function field(id: string, type: FieldType): ResourceMapperField {
    return {
        id,
        displayName: id,
        type,
        required: false,
        display: true,
        defaultMatch: false,
    };
}

function mapper(value: Record<string, unknown>, schema: ResourceMapperField[]) {
    return {
        mappingMode: 'defineBelow',
        value,
        matchingColumns: [],
        schema,
        attemptToConvertTypes: false,
        convertFieldsToString: false,
    };
}

describe('ResourceMapperCoercer', () => {
    describe('coerceMessage', () => {
        it('returns empty object for nullish / non-object input', () => {
            expect(ResourceMapperCoercer.coerceMessage(undefined, ctx, 0)).toEqual({});
            expect(ResourceMapperCoercer.coerceMessage(null, ctx, 0)).toEqual({});
            expect(ResourceMapperCoercer.coerceMessage('nope', ctx, 0)).toEqual({});
        });

        it('returns empty object when the mapper value is null', () => {
            const structure = mapper({}, []);
            structure.value = null as unknown as Record<string, unknown>;
            expect(ResourceMapperCoercer.coerceMessage(structure, ctx, 0)).toEqual({});
        });

        it('parses an array field entered as a string', () => {
            const structure = mapper({ data: '[0.5, 0.5, 0.6]' }, [field('data', 'array')]);
            expect(ResourceMapperCoercer.coerceMessage(structure, ctx, 0)).toEqual({
                data: [0.5, 0.5, 0.6],
            });
        });

        it('keeps an array field already provided as an array', () => {
            const structure = mapper({ data: [1, 2, 3] }, [field('data', 'array')]);
            expect(ResourceMapperCoercer.coerceMessage(structure, ctx, 0)).toEqual({
                data: [1, 2, 3],
            });
        });

        it('parses an object field entered as a string', () => {
            const structure = mapper({ layout: '{"data_offset": 0}' }, [field('layout', 'object')]);
            expect(ResourceMapperCoercer.coerceMessage(structure, ctx, 0)).toEqual({
                layout: { data_offset: 0 },
            });
        });

        it('parses number and boolean fields entered as strings', () => {
            const structure = mapper({ count: '42', enabled: 'true' }, [
                field('count', 'number'),
                field('enabled', 'boolean'),
            ]);
            expect(ResourceMapperCoercer.coerceMessage(structure, ctx, 0)).toEqual({
                count: 42,
                enabled: true,
            });
        });

        it('leaves string fields untouched', () => {
            const structure = mapper({ data: 'hello' }, [field('data', 'string')]);
            expect(ResourceMapperCoercer.coerceMessage(structure, ctx, 0)).toEqual({ data: 'hello' });
        });

        it('leaves fields without a schema entry untouched', () => {
            const structure = mapper({ goal: 'test' }, []);
            expect(ResourceMapperCoercer.coerceMessage(structure, ctx, 0)).toEqual({ goal: 'test' });
        });

        it('passes through null / undefined field values', () => {
            const structure = mapper({ a: null, b: undefined as unknown as string }, [
                field('a', 'array'),
                field('b', 'number'),
            ]);
            expect(ResourceMapperCoercer.coerceMessage(structure, ctx, 0)).toEqual({
                a: null,
                b: undefined,
            });
        });

        it('throws when an array field cannot be parsed into an array', () => {
            const structure = mapper({ data: 'not-json' }, [field('data', 'array')]);
            expect(() => ResourceMapperCoercer.coerceMessage(structure, ctx, 0)).toThrow(
                /Field "data" expects a value of type "array"/,
            );
        });

        it('throws when a string parses to the wrong JSON type', () => {
            const structure = mapper({ data: '0.5' }, [field('data', 'array')]);
            expect(() => ResourceMapperCoercer.coerceMessage(structure, ctx, 0)).toThrow(/cannot be parsed into array/);
        });

        it('throws when a number field is not numeric', () => {
            const structure = mapper({ count: 'abc' }, [field('count', 'number')]);
            expect(() => ResourceMapperCoercer.coerceMessage(structure, ctx, 0)).toThrow(
                /Field "count" expects a value of type "number"/,
            );
        });

        it('throws when a boolean field is neither true nor false', () => {
            const structure = mapper({ enabled: 'yes' }, [field('enabled', 'boolean')]);
            expect(() => ResourceMapperCoercer.coerceMessage(structure, ctx, 0)).toThrow(
                /Field "enabled" expects a value of type "boolean"/,
            );
        });

        it('throws when an object field is actually a JSON array', () => {
            const structure = mapper({ layout: '[1, 2]' }, [field('layout', 'object')]);
            expect(() => ResourceMapperCoercer.coerceMessage(structure, ctx, 0)).toThrow(
                /Field "layout" expects a value of type "object"/,
            );
        });

        it('supports the legacy flat structure without a value key', () => {
            expect(ResourceMapperCoercer.coerceMessage({ data: 'hello' }, ctx, 0)).toEqual({
                data: 'hello',
            });
        });
    });
});
