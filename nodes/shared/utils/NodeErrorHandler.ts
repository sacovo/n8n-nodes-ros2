/**
 * Utility functions for error handling in nodes
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { RosBridgeConnectionError, RosBridgeTimeoutError } from '../services/RosBridgeService';

export class NodeErrorHandler {
    /**
     * Errors thrown while a node runs as an AI agent tool abort the whole
     * agent run: n8n's tool wrapper rethrows them and the agent's LangChain
     * executor has no tool-error handling. Returning the error as regular
     * output instead turns it into a tool observation the model can react
     * to, so tool executions always soft-fail like continue-on-fail.
     */
    static shouldReturnErrorOutput(executeFunctions: IExecuteFunctions): boolean {
        return executeFunctions.continueOnFail() || executeFunctions.isToolExecution();
    }

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
