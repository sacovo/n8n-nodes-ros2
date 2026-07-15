/**
 * Unit tests for MessageTypeValidator
 */

import { MessageTypeValidator } from '../utils/MessageTypeValidator';
import type { ExpandedTypeDef } from '../services/RosApiService';
import type { IExecuteFunctions } from 'n8n-workflow';

const ctx = {
    getNode: () => ({ name: 'Test Node' }),
} as unknown as IExecuteFunctions;

// std_msgs/Float64MultiArray, fully expanded.
const float64MultiArray: ExpandedTypeDef = {
    layout: {
        dim: [{ label: 'string', size: 'uint32', stride: 'uint32' }],
        data_offset: 'uint32',
    },
    data: ['float64'],
};

describe('MessageTypeValidator', () => {
    describe('validate', () => {
        it('parses an array field entered as a JSON string', () => {
            const result = MessageTypeValidator.validate(
                { data: '[0.5, 0.5, 0.6]' },
                float64MultiArray,
                ctx,
                0,
            );
            expect(result).toEqual({ data: [0.5, 0.5, 0.6] });
        });

        it('parses a nested object entered as a JSON string and coerces its leaves', () => {
            const result = MessageTypeValidator.validate(
                { layout: '{"data_offset": "3", "dim": []}', data: [1, 2] },
                float64MultiArray,
                ctx,
                0,
            );
            expect(result).toEqual({ layout: { data_offset: 3, dim: [] }, data: [1, 2] });
        });

        it('validates and coerces elements inside arrays of nested messages', () => {
            const result = MessageTypeValidator.validate(
                { layout: { dim: [{ label: 'rows', size: '2', stride: '6' }], data_offset: 0 }, data: [] },
                float64MultiArray,
                ctx,
                0,
            );
            expect(result).toEqual({
                layout: { dim: [{ label: 'rows', size: 2, stride: 6 }], data_offset: 0 },
                data: [],
            });
        });

        it('coerces numeric and boolean strings', () => {
            const def: ExpandedTypeDef = { count: 'int32', enabled: 'bool' };
            const result = MessageTypeValidator.validate({ count: '42', enabled: 'true' }, def, ctx, 0);
            expect(result).toEqual({ count: 42, enabled: true });
        });

        it('leaves unresolved / opaque leaf types untouched', () => {
            const def: ExpandedTypeDef = { stamp: 'time' };
            const value = { stamp: { sec: 1, nanosec: 2 } };
            expect(MessageTypeValidator.validate(value, def, ctx, 0)).toEqual(value);
        });

        it('leaves unset fields to ROS defaults', () => {
            const result = MessageTypeValidator.validate({ data: null }, float64MultiArray, ctx, 0);
            expect(result).toEqual({ data: null });
        });

        it('throws when an array field cannot be parsed into an array', () => {
            expect(() =>
                MessageTypeValidator.validate({ data: 'not-json' }, float64MultiArray, ctx, 0),
            ).toThrow(/"data" expects an array/);
        });

        it('throws with the element path when an array element has the wrong type', () => {
            expect(() =>
                MessageTypeValidator.validate({ data: [1, 'nope', 3] }, float64MultiArray, ctx, 0),
            ).toThrow(/"data\[1\]" expects a number/);
        });

        it('throws with the nested path when a deep field has the wrong type', () => {
            expect(() =>
                MessageTypeValidator.validate(
                    { layout: { data_offset: 'abc' } },
                    float64MultiArray,
                    ctx,
                    0,
                ),
            ).toThrow(/"layout\.data_offset" expects a number/);
        });

        it('rejects unknown fields and lists the allowed ones', () => {
            expect(() =>
                MessageTypeValidator.validate({ nope: 1 }, float64MultiArray, ctx, 0),
            ).toThrow(/"nope" is not a field of this type\. Allowed fields: layout, data/);
        });

        it('rejects an object where an array is expected', () => {
            expect(() =>
                MessageTypeValidator.validate({ data: { 0: 1 } }, float64MultiArray, ctx, 0),
            ).toThrow(/"data" expects an array/);
        });
    });

    describe('validateAgainstType', () => {
        it('validates when the type can be fetched', async () => {
            const result = await MessageTypeValidator.validateAgainstType(
                { data: '[1, 2]' },
                ctx,
                0,
                async () => float64MultiArray,
            );
            expect(result).toEqual({ data: [1, 2] });
        });

        it('skips validation (returns payload as-is) when the type cannot be fetched', async () => {
            const payload = { data: 'anything at all' };
            const result = await MessageTypeValidator.validateAgainstType(payload, ctx, 0, async () => {
                throw new Error('rosapi unavailable');
            });
            expect(result).toBe(payload);
        });

        it('skips validation when the fetched def is not a struct', async () => {
            const payload = { whatever: 1 };
            const result = await MessageTypeValidator.validateAgainstType(
                payload,
                ctx,
                0,
                async () => 'std_msgs/String' as ExpandedTypeDef,
            );
            expect(result).toBe(payload);
        });

        it('still throws on a genuine type mismatch', async () => {
            await expect(
                MessageTypeValidator.validateAgainstType(
                    { data: 'not-json' },
                    ctx,
                    0,
                    async () => float64MultiArray,
                ),
            ).rejects.toThrow(/"data" expects an array/);
        });
    });
});
