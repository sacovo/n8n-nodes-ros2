/**
 * Unit tests for RosActionCancel node
 */

import { RosActionCancel } from '../RosActionCancel.node';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import { ParameterExtractor } from '../../shared/utils/ParameterExtractor';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

// Mock the services
jest.mock('../../shared/services/RosBridgeService');
jest.mock('../../shared/utils/ParameterExtractor');

const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;
const mockParameterExtractor = ParameterExtractor as jest.Mocked<typeof ParameterExtractor>;

describe('RosActionCancel', () => {
    let node: RosActionCancel;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosActionCancel();
    });

    describe('execute', () => {
        it('should cancel action successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNodeParameter: jest.fn(),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockReturnValue('goal-123');

            (mockExecuteFunctions.getNodeParameter as jest.Mock)
                .mockReturnValueOnce({ mode: 'id', value: '/fibonacci' }) // serverName
                .mockReturnValueOnce({ mode: 'id', value: 'action_tutorials_interfaces/Fibonacci' }); // actionName

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.cancelAction.mockResolvedValue({ status: 'canceled' });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                goalId: 'goal-123',
                serverName: '/fibonacci',
                actionName: 'action_tutorials_interfaces/Fibonacci',
                cancelResult: { status: 'canceled' },
                canceledAt: expect.any(String),
            });

            expect(mockRosBridgeService.cancelAction).toHaveBeenCalledWith(
                {},
                '/fibonacci',
                'action_tutorials_interfaces/Fibonacci',
                'goal-123',
            );
        });
    });

    describe('read-only credential', () => {
        it('should refuse to cancel a goal without connecting', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({ readOnly: true }),
                continueOnFail: jest.fn().mockReturnValue(false),
                isToolExecution: jest.fn().mockReturnValue(false),
                getNodeOutputs: jest.fn().mockReturnValue([]),
                getNode: jest.fn().mockReturnValue({ name: 'ROS2 Action Cancel', type: 'rosActionCancel' }),
                getNodeParameter: jest.fn(),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockReturnValue('goal-123');
            (mockExecuteFunctions.getNodeParameter as jest.Mock)
                .mockReturnValueOnce({ mode: 'id', value: '/fibonacci' }) // serverName
                .mockReturnValueOnce({ mode: 'id', value: 'action_tutorials_interfaces/Fibonacci' }); // actionName

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow(/read-only/);
            expect(mockRosBridgeService.connect).not.toHaveBeenCalled();
            expect(mockRosBridgeService.cancelAction).not.toHaveBeenCalled();
        });
    });
});
