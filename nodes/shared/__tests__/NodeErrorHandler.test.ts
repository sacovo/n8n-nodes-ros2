/**
 * Unit tests for NodeErrorHandler.shouldReturnErrorOutput
 */

import { NodeErrorHandler } from '../utils/NodeErrorHandler';
import type { IExecuteFunctions } from 'n8n-workflow';

describe('NodeErrorHandler.shouldReturnErrorOutput', () => {
    function buildContext(
        continueOnFail: boolean,
        isToolExecution: boolean,
        outputTypes: string[] = ['main'],
    ): IExecuteFunctions {
        return {
            continueOnFail: jest.fn().mockReturnValue(continueOnFail),
            isToolExecution: jest.fn().mockReturnValue(isToolExecution),
            getNodeOutputs: jest.fn().mockReturnValue(outputTypes.map((type) => ({ type }))),
        } as unknown as IExecuteFunctions;
    }

    it('returns true when the node is set to continue on fail', () => {
        expect(NodeErrorHandler.shouldReturnErrorOutput(buildContext(true, false))).toBe(true);
    });

    it('returns true when the node runs as an AI agent tool via direct invocation', () => {
        expect(NodeErrorHandler.shouldReturnErrorOutput(buildContext(false, true))).toBe(true);
    });

    it('returns true for the generated *Tool node variant even when isToolExecution reports false', () => {
        // Engine-driven tool calls (n8n >= 2.2x) execute the tool node like a
        // regular node, where isToolExecution() is hardcoded to false — the
        // ai_tool output is the only remaining signal.
        expect(NodeErrorHandler.shouldReturnErrorOutput(buildContext(false, false, ['ai_tool']))).toBe(true);
    });

    it('returns false for a regular workflow execution without continue on fail', () => {
        expect(NodeErrorHandler.shouldReturnErrorOutput(buildContext(false, false, ['main']))).toBe(false);
    });
});
