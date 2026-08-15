/**
 * Unit tests for RosActionSendFeedback node
 */

import { RosActionSendFeedback } from '../RosActionSendFeedback.node';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import { ParameterExtractor } from '../../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../../shared/utils/NodeErrorHandler';
import type { IExecuteFunctions } from 'n8n-workflow';

jest.mock('../../shared/services/RosBridgeService');
jest.mock('../../shared/utils/ParameterExtractor');
jest.mock('../../shared/utils/NodeErrorHandler');

const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;
const mockParameterExtractor = ParameterExtractor as jest.Mocked<typeof ParameterExtractor>;
const mockNodeErrorHandler = NodeErrorHandler as jest.Mocked<typeof NodeErrorHandler>;

function buildExecuteFunctions(
    operation: string,
    credentials: Record<string, unknown> = {},
): IExecuteFunctions {
    return {
        getInputData: jest.fn().mockReturnValue([{}]),
        getCredentials: jest.fn().mockResolvedValue(credentials),
        continueOnFail: jest.fn().mockReturnValue(false),
        getNode: jest.fn().mockReturnValue({ name: 'ROS2 Action Send Feedback', type: 'rosActionSendFeedback' }),
        getNodeParameter: jest.fn().mockImplementation((name: string) => {
            if (name === 'goalId') return 'goal-123';
            if (name === 'operation') return operation;
            if (name === 'payloadJson') return '{"progress":0.5}';
            return undefined;
        }),
    } as unknown as IExecuteFunctions;
}

describe('RosActionSendFeedback', () => {
    let node: RosActionSendFeedback;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosActionSendFeedback();
        mockParameterExtractor.parseJsonParameter.mockReturnValue({ progress: 0.5 });
    });

    it('should require the rosbridge credential, since sending feedback is a write', () => {
        expect(node.description.credentials).toContainEqual({
            name: 'rosBridgeApi',
            required: true,
            testedBy: 'rosBridgeApi',
        });
    });

    it('should send feedback for the goal', async () => {
        const result = await node.execute.call(buildExecuteFunctions('sendFeedback'));

        expect(mockRosBridgeService.sendActionFeedback).toHaveBeenCalledWith('goal-123', { progress: 0.5 });
        expect(result[0][0].json).toMatchObject({ goalId: 'goal-123', operation: 'sendFeedback' });
    });

    describe('read-only credential', () => {
        beforeEach(() => {
            mockNodeErrorHandler.shouldReturnErrorOutput.mockReturnValue(true);
            mockNodeErrorHandler.buildErrorOutput.mockImplementation((error) => ({
                error: (error as Error).message,
            }));
        });

        it.each([
            ['sendFeedback', 'sendActionFeedback'],
            ['setSucceeded', 'setActionSucceeded'],
            ['setAborted', 'setActionAborted'],
        ] as const)('should refuse %s', async (operation, serviceMethod) => {
            const result = await node.execute.call(buildExecuteFunctions(operation, { readOnly: true }));

            expect(result[0][0].json.error).toContain('read-only');
            expect(mockRosBridgeService[serviceMethod]).not.toHaveBeenCalled();
        });
    });
});
