/**
 * Unit tests for RosActionResult node
 */

import { RosActionResult } from '../RosActionResult.node';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import { ParameterExtractor } from '../../shared/utils/ParameterExtractor';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

// Mock the services
jest.mock('../../shared/services/RosBridgeService');
jest.mock('../../shared/utils/ParameterExtractor');

const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;
const mockParameterExtractor = ParameterExtractor as jest.Mocked<typeof ParameterExtractor>;

describe('RosActionResult', () => {
    let node: RosActionResult;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosActionResult();
    });

    describe('execute', () => {
        it('should get action result successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNodeParameter: jest.fn(),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockReturnValue('goal-123');
            mockParameterExtractor.extractRequiredNumber.mockReturnValue(60000);

            (mockExecuteFunctions.getNodeParameter as jest.Mock)
                .mockReturnValueOnce({ mode: 'id', value: '/fibonacci' }) // serverName
                .mockReturnValueOnce({ mode: 'id', value: 'action_tutorials_interfaces/Fibonacci' }); // actionName

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.getActionResult.mockResolvedValue({ sequence: [1, 1, 2] });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                goalId: 'goal-123',
                serverName: '/fibonacci',
                actionName: 'action_tutorials_interfaces/Fibonacci',
                result: { sequence: [1, 1, 2] },
                retrievedAt: expect.any(String),
            });

            expect(mockRosBridgeService.getActionResult).toHaveBeenCalledWith(
                {},
                '/fibonacci',
                'action_tutorials_interfaces/Fibonacci',
                'goal-123',
                60000,
            );
        });
    });
});
