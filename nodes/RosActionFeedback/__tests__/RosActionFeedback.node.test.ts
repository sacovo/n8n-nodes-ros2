/**
 * Unit tests for RosActionFeedback node
 */

import { RosActionFeedback } from '../RosActionFeedback.node';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import { ParameterExtractor } from '../../shared/utils/ParameterExtractor';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

// Mock the services
jest.mock('../../shared/services/RosBridgeService');
jest.mock('../../shared/utils/ParameterExtractor');

const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;
const mockParameterExtractor = ParameterExtractor as jest.Mocked<typeof ParameterExtractor>;

describe('RosActionFeedback', () => {
    let node: RosActionFeedback;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosActionFeedback();
    });

    describe('execute', () => {
        it('should get action feedback successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNodeParameter: jest.fn(),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockReturnValue('goal-123');
            mockParameterExtractor.extractRequiredNumber.mockReturnValue(5000);

            (mockExecuteFunctions.getNodeParameter as jest.Mock)
                .mockReturnValueOnce({ mode: 'id', value: '/fibonacci' }) // serverName
                .mockReturnValueOnce({ mode: 'id', value: 'action_tutorials_interfaces/Fibonacci' }); // actionName

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.waitForActionFeedback.mockResolvedValue({ partial_sequence: [1, 1] });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                goalId: 'goal-123',
                serverName: '/fibonacci',
                actionName: 'action_tutorials_interfaces/Fibonacci',
                feedback: { partial_sequence: [1, 1] },
                receivedAt: expect.any(String),
            });

            expect(mockRosBridgeService.waitForActionFeedback).toHaveBeenCalledWith(
                {},
                '/fibonacci',
                'action_tutorials_interfaces/Fibonacci',
                'goal-123',
                5000,
            );
        });
    });
});
