/**
 * Unit tests for NodeErrorHandler.shouldReturnErrorOutput
 */

import { NodeErrorHandler } from '../utils/NodeErrorHandler';
import type { IExecuteFunctions } from 'n8n-workflow';

describe('NodeErrorHandler.shouldReturnErrorOutput', () => {
    function buildContext(continueOnFail: boolean, isToolExecution: boolean): IExecuteFunctions {
        return {
            continueOnFail: jest.fn().mockReturnValue(continueOnFail),
            isToolExecution: jest.fn().mockReturnValue(isToolExecution),
        } as unknown as IExecuteFunctions;
    }

    it('returns true when the node is set to continue on fail', () => {
        expect(NodeErrorHandler.shouldReturnErrorOutput(buildContext(true, false))).toBe(true);
    });

    it('returns true when the node runs as an AI agent tool', () => {
        expect(NodeErrorHandler.shouldReturnErrorOutput(buildContext(false, true))).toBe(true);
    });

    it('returns false for a regular workflow execution without continue on fail', () => {
        expect(NodeErrorHandler.shouldReturnErrorOutput(buildContext(false, false))).toBe(false);
    });
});
