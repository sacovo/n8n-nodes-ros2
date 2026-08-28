/**
 * Unit tests for RosActionRespond node.
 *
 * Ported from the RosActionSendFeedback tests this node replaces; the
 * read-only-credential cases carry over unchanged in intent, with Set Aborted
 * replaced by Set Failed and Set Canceled added.
 */

import { RosActionRespond } from '../RosActionRespond.node';
import { RosActionServerService } from '../../shared/services/RosActionServerService';
import { ParameterExtractor } from '../../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../../shared/utils/NodeErrorHandler';
import type { IExecuteFunctions } from 'n8n-workflow';

jest.mock('../../shared/services/RosActionServerService');
jest.mock('../../shared/utils/ParameterExtractor');
jest.mock('../../shared/utils/NodeErrorHandler');

const mockActionServerService = RosActionServerService as jest.Mocked<typeof RosActionServerService>;
const mockParameterExtractor = ParameterExtractor as jest.Mocked<typeof ParameterExtractor>;
const mockNodeErrorHandler = NodeErrorHandler as jest.Mocked<typeof NodeErrorHandler>;

function buildExecuteFunctions(operation: string, credentials: Record<string, unknown> = {}): IExecuteFunctions {
    return {
        getInputData: jest.fn().mockReturnValue([{}]),
        getCredentials: jest.fn().mockResolvedValue(credentials),
        continueOnFail: jest.fn().mockReturnValue(false),
        getNode: jest.fn().mockReturnValue({ name: 'ROS2 Action Respond', type: 'rosActionRespond' }),
        getNodeParameter: jest.fn().mockImplementation((name: string) => {
            if (name === 'operation') return operation;
            if (name === 'payloadJson') return '{"progress":0.5}';
            return undefined;
        }),
    } as unknown as IExecuteFunctions;
}

describe('RosActionRespond', () => {
    let node: RosActionRespond;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosActionRespond();
        mockParameterExtractor.extractRequiredString.mockReturnValue('goal-123');
        mockParameterExtractor.parseJsonParameter.mockReturnValue({ progress: 0.5 });
        mockNodeErrorHandler.shouldReturnErrorOutput.mockReturnValue(false);
    });

    it('should require the rosbridge credential, since responding is a write', () => {
        expect(node.description.credentials).toContainEqual({
            name: 'rosBridgeApi',
            required: true,
            testedBy: 'rosBridgeApi',
        });
    });

    it('should send feedback for the goal', async () => {
        const result = await node.execute.call(buildExecuteFunctions('sendFeedback'));

        expect(mockActionServerService.sendFeedback).toHaveBeenCalledWith('goal-123', { progress: 0.5 });
        expect(result[0][0].json).toMatchObject({ goalId: 'goal-123', operation: 'sendFeedback' });
    });

    it.each([
        ['setSucceeded', 'setSucceeded'],
        ['setCanceled', 'setCanceled'],
    ] as const)('should complete the goal via %s', async (operation, serviceMethod) => {
        await node.execute.call(buildExecuteFunctions(operation));

        expect(mockActionServerService[serviceMethod]).toHaveBeenCalledWith('goal-123', { progress: 0.5 });
    });

    it('should abort the goal without a payload for setFailed', async () => {
        const result = await node.execute.call(buildExecuteFunctions('setFailed'));

        expect(mockActionServerService.setFailed).toHaveBeenCalledWith('goal-123');
        expect(result[0][0].json).not.toHaveProperty('payload');
    });

    describe('read-only credential', () => {
        beforeEach(() => {
            mockNodeErrorHandler.shouldReturnErrorOutput.mockReturnValue(true);
            mockNodeErrorHandler.buildErrorOutput.mockImplementation((error) => ({
                error: (error as Error).message,
            }));
        });

        it.each([
            ['sendFeedback', 'sendFeedback'],
            ['setSucceeded', 'setSucceeded'],
            ['setCanceled', 'setCanceled'],
            ['setFailed', 'setFailed'],
        ] as const)('should refuse %s', async (operation, serviceMethod) => {
            const result = await node.execute.call(buildExecuteFunctions(operation, { readOnly: true }));

            expect(result[0][0].json.error).toContain('read-only');
            expect(mockActionServerService[serviceMethod]).not.toHaveBeenCalled();
        });
    });
});
