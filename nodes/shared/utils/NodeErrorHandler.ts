/**
 * Utility functions for error handling in nodes
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { RosBridgeConnectionError, RosBridgeTimeoutError } from '../services/RosBridgeService';
import type { NodeContext } from './NodeContext';

export class NodeErrorHandler {
    /**
     * Errors thrown while a node runs as an AI agent tool abort the whole
     * agent run: n8n's tool wrapper rethrows them and the agent's LangChain
     * executor has no tool-error handling. Returning the error as regular
     * output instead turns it into a tool observation the model can react
     * to, so tool executions always soft-fail like continue-on-fail.
     */
    static shouldReturnErrorOutput(executeFunctions: IExecuteFunctions): boolean {
        if (executeFunctions.continueOnFail() || executeFunctions.isToolExecution()) {
            return true;
        }
        // isToolExecution() only covers the legacy direct-invocation tool
        // path (SupplyDataContext); newer n8n runs agent tool calls through
        // the regular workflow engine, whose ExecuteContext hardcodes it to
        // false. The generated *Tool node variant is still recognizable
        // there by its single ai_tool output.
        return executeFunctions.getNodeOutputs().some((output) => output.type === NodeConnectionTypes.AiTool);
    }

    /**
     * Rethrows `error` as the n8n error type that fits it: connection and
     * timeout failures are the remote system's fault and surface as a
     * NodeApiError, everything else as a NodeOperationError. Never returns.
     */
    static handle(context: NodeContext, error: Error | unknown, itemIndex: number): never {
        const actualError = error instanceof Error ? error : new Error(String(error));

        if (actualError instanceof RosBridgeConnectionError || actualError instanceof RosBridgeTimeoutError) {
            throw new NodeApiError(context.getNode(), { message: actualError.message, itemIndex });
        }

        throw new NodeOperationError(context.getNode(), actualError, { itemIndex });
    }

    static buildErrorOutput(error: Error | unknown): { error: string } {
        if (error instanceof Error) {
            return { error: error.message };
        }
        return { error: String(error) };
    }
}
