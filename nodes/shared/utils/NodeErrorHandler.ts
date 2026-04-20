/**
 * Utility functions for error handling in nodes
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { RosBridgeConnectionError, RosBridgeTimeoutError } from '../services/RosBridgeService';

export class NodeErrorHandler {
    static handle(
        executeFunctions: IExecuteFunctions,
        error: Error | unknown,
        itemIndex: number,
        shouldContinueOnFail: boolean = false,
    ): { error: Error; isApiError: boolean } | null {
        const actualError = error instanceof Error ? error : new Error(String(error));

        if (shouldContinueOnFail) {
            return null;
        }

        if (actualError instanceof RosBridgeConnectionError || actualError instanceof RosBridgeTimeoutError) {
            throw new NodeApiError(executeFunctions.getNode(), { message: actualError.message, itemIndex });
        }

        throw new NodeOperationError(executeFunctions.getNode(), actualError, { itemIndex });
    }

    static buildErrorOutput(error: Error | unknown): { error: string } {
        if (error instanceof Error) {
            return { error: error.message };
        }
        return { error: String(error) };
    }
}
