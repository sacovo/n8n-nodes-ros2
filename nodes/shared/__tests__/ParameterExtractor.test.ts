/**
 * Unit tests for ParameterExtractor utility
 */

import { ParameterExtractor } from '../utils/ParameterExtractor';
import type { IExecuteFunctions } from 'n8n-workflow';

describe('ParameterExtractor', () => {
    describe('parseJsonParameter', () => {
        // parseJsonParameter reports failures as NodeOperationError, which needs
        // the node it happened on.
        const context = { getNode: () => ({ name: 'Test Node' }) } as unknown as IExecuteFunctions;

        it('parses valid JSON object', () => {
            const input = '{"key": "value", "number": 42}';

            const result = ParameterExtractor.parseJsonParameter(input, 'testParam', context);

            expect(result).toEqual({ key: 'value', number: 42 });
        });

        it('returns empty object for empty string', () => {
            const result = ParameterExtractor.parseJsonParameter('', 'testParam', context);

            expect(result).toEqual({});
        });

        it('returns empty object for whitespace only', () => {
            const result = ParameterExtractor.parseJsonParameter('   ', 'testParam', context);

            expect(result).toEqual({});
        });

        it('throws error for invalid JSON', () => {
            const input = '{invalid json}';

            expect(() => ParameterExtractor.parseJsonParameter(input, 'testParam', context)).toThrow(
                'Invalid JSON in parameter "testParam"',
            );
        });

        it('throws error for JSON array', () => {
            const input = '[1, 2, 3]';

            expect(() => ParameterExtractor.parseJsonParameter(input, 'testParam', context)).toThrow(
                'must be a JSON object',
            );
        });

        it('throws error for JSON string', () => {
            const input = '"just a string"';

            expect(() => ParameterExtractor.parseJsonParameter(input, 'testParam', context)).toThrow(
                'must be a JSON object',
            );
        });

        it('throws error for JSON null', () => {
            const input = 'null';

            expect(() => ParameterExtractor.parseJsonParameter(input, 'testParam', context)).toThrow(
                'must be a JSON object',
            );
        });

        it('throws error for JSON number', () => {
            const input = '42';

            expect(() => ParameterExtractor.parseJsonParameter(input, 'testParam', context)).toThrow(
                'must be a JSON object',
            );
        });

        it('throws error for JSON boolean', () => {
            const input = 'true';

            expect(() => ParameterExtractor.parseJsonParameter(input, 'testParam', context)).toThrow(
                'must be a JSON object',
            );
        });
    });

    describe('extractRequiredString', () => {
        it('extracts valid string parameter', () => {
            const mockFunctions = {
                getNodeParameter: () => 'valid string',
            } as unknown as IExecuteFunctions;

            const result = ParameterExtractor.extractRequiredString(mockFunctions, 0, 'testParam');

            expect(result).toBe('valid string');
        });

        it('throws error for empty string', () => {
            const mockFunctions = {
                getNodeParameter: () => '',
                getNode: () => ({}),
            } as unknown as IExecuteFunctions;

            expect(() => ParameterExtractor.extractRequiredString(mockFunctions, 0, 'testParam')).toThrow();
        });

        it('throws error for non-string value', () => {
            const mockFunctions = {
                getNodeParameter: () => 123,
                getNode: () => ({}),
            } as unknown as IExecuteFunctions;

            expect(() => ParameterExtractor.extractRequiredString(mockFunctions, 0, 'testParam')).toThrow();
        });
    });

    describe('extractRequiredNumber', () => {
        it('extracts valid number parameter', () => {
            const mockFunctions = {
                getNodeParameter: () => 42,
            } as unknown as IExecuteFunctions;

            const result = ParameterExtractor.extractRequiredNumber(mockFunctions, 0, 'testParam');

            expect(result).toBe(42);
        });

        it('throws error for NaN', () => {
            const mockFunctions = {
                getNodeParameter: () => Number.NaN,
                getNode: () => ({}),
            } as unknown as IExecuteFunctions;

            expect(() => ParameterExtractor.extractRequiredNumber(mockFunctions, 0, 'testParam')).toThrow();
        });

        it('throws error for non-number value', () => {
            const mockFunctions = {
                getNodeParameter: () => 'not a number',
                getNode: () => ({}),
            } as unknown as IExecuteFunctions;

            expect(() => ParameterExtractor.extractRequiredNumber(mockFunctions, 0, 'testParam')).toThrow();
        });
    });

    describe('extractOptionalString', () => {
        it('extracts valid string parameter', () => {
            const mockFunctions = {
                getNodeParameter: () => 'value',
            } as unknown as IExecuteFunctions;

            const result = ParameterExtractor.extractOptionalString(mockFunctions, 0, 'testParam');

            expect(result).toBe('value');
        });

        it('returns undefined for undefined value', () => {
            const mockFunctions = {
                getNodeParameter: () => undefined,
            } as unknown as IExecuteFunctions;

            const result = ParameterExtractor.extractOptionalString(mockFunctions, 0, 'testParam');

            expect(result).toBeUndefined();
        });

        it('returns undefined for null value', () => {
            const mockFunctions = {
                getNodeParameter: () => null,
            } as unknown as IExecuteFunctions;

            const result = ParameterExtractor.extractOptionalString(mockFunctions, 0, 'testParam');

            expect(result).toBeUndefined();
        });

        it('returns undefined for empty string', () => {
            const mockFunctions = {
                getNodeParameter: () => '',
            } as unknown as IExecuteFunctions;

            const result = ParameterExtractor.extractOptionalString(mockFunctions, 0, 'testParam');

            expect(result).toBeUndefined();
        });

        it('throws error for non-string value', () => {
            const mockFunctions = {
                getNodeParameter: () => 123,
                getNode: () => ({}),
            } as unknown as IExecuteFunctions;

            expect(() => ParameterExtractor.extractOptionalString(mockFunctions, 0, 'testParam')).toThrow();
        });
    });

    describe('extractJsonParameter', () => {
        it('extracts and parses valid JSON parameter', () => {
            const mockFunctions = {
                getNodeParameter: () => '{"key": "value"}',
            } as unknown as IExecuteFunctions;

            const result = ParameterExtractor.extractJsonParameter(mockFunctions, 0, 'testParam');

            expect(result).toEqual({ key: 'value' });
        });

        it('throws error for invalid JSON string', () => {
            const mockFunctions = {
                getNodeParameter: () => '{invalid}',
            } as unknown as IExecuteFunctions;

            expect(() => ParameterExtractor.extractJsonParameter(mockFunctions, 0, 'testParam')).toThrow();
        });

        it('throws error for non-string parameter', () => {
            const mockFunctions = {
                getNodeParameter: () => 123,
                getNode: () => ({}),
            } as unknown as IExecuteFunctions;

            expect(() => ParameterExtractor.extractJsonParameter(mockFunctions, 0, 'testParam')).toThrow();
        });
    });
});
