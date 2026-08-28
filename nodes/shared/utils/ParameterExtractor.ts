/**
 * Utility functions for parameter extraction and validation
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import type { NodeContext } from './NodeContext';

export type JsonRecord = Record<string, unknown>;

export class ParameterExtractor {
    static parseJsonParameter(input: string, parameterName: string, context: NodeContext, itemIndex = 0): JsonRecord {
        if (!input.trim()) {
            return {};
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(input);
        } catch (error) {
            throw new NodeOperationError(
                context.getNode(),
                `Invalid JSON in parameter "${parameterName}": ${(error as Error).message}`,
                { itemIndex },
            );
        }

        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            throw new NodeOperationError(context.getNode(), `Parameter "${parameterName}" must be a JSON object`, {
                itemIndex,
            });
        }

        return parsed as JsonRecord;
    }

    static extractRequiredString(
        executeFunctions: IExecuteFunctions,
        itemIndex: number,
        parameterName: string,
    ): string {
        const value = executeFunctions.getNodeParameter(parameterName, itemIndex) as unknown;

        if (typeof value !== 'string' || !value.trim()) {
            throw new NodeOperationError(
                executeFunctions.getNode(),
                `Parameter "${parameterName}" must be a non-empty string`,
                { itemIndex },
            );
        }

        return value as string;
    }

    static extractRequiredNumber(
        executeFunctions: IExecuteFunctions,
        itemIndex: number,
        parameterName: string,
    ): number {
        const value = executeFunctions.getNodeParameter(parameterName, itemIndex) as unknown;

        if (typeof value !== 'number' || Number.isNaN(value)) {
            throw new NodeOperationError(
                executeFunctions.getNode(),
                `Parameter "${parameterName}" must be a valid number`,
                { itemIndex },
            );
        }

        return value as number;
    }

    static extractOptionalString(
        executeFunctions: IExecuteFunctions,
        itemIndex: number,
        parameterName: string,
    ): string | undefined {
        const value = executeFunctions.getNodeParameter(parameterName, itemIndex) as unknown;

        if (value === undefined || value === null || value === '') {
            return undefined;
        }

        if (typeof value !== 'string') {
            throw new NodeOperationError(executeFunctions.getNode(), `Parameter "${parameterName}" must be a string`, {
                itemIndex,
            });
        }

        return value as string;
    }

    static extractJsonParameter(
        executeFunctions: IExecuteFunctions,
        itemIndex: number,
        parameterName: string,
    ): JsonRecord {
        const value = executeFunctions.getNodeParameter(parameterName, itemIndex) as unknown;

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            return value as JsonRecord;
        }

        if (typeof value !== 'string') {
            throw new NodeOperationError(
                executeFunctions.getNode(),
                `Parameter "${parameterName}" must be a string or JSON object`,
                { itemIndex },
            );
        }

        return this.parseJsonParameter(value, parameterName, executeFunctions, itemIndex);
    }
}
