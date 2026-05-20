/**
 * Unit tests for RosActionStatus node
 */

import { RosActionStatus } from '../RosActionStatus.node';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import { ParameterExtractor } from '../../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../../shared/utils/NodeErrorHandler';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

// Mock the services
jest.mock('../../shared/services/RosBridgeService');
jest.mock('../../shared/utils/ParameterExtractor');
jest.mock('../../shared/utils/NodeErrorHandler');

const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;
const mockParameterExtractor = ParameterExtractor as jest.Mocked<typeof ParameterExtractor>;
const mockNodeErrorHandler = NodeErrorHandler as jest.Mocked<typeof NodeErrorHandler>;

describe('RosActionStatus', () => {
    let node: RosActionStatus;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosActionStatus();
    });

    describe('execute', () => {
        it('should get action status successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNodeParameter: jest.fn(),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString
                .mockReturnValueOnce('goal-123')
                .mockReturnValueOnce('action_msgs/GoalStatusArray');

            (mockExecuteFunctions.getNodeParameter as jest.Mock)
                .mockReturnValueOnce({ mode: 'id', value: '/fibonacci' }) // serverName
                .mockReturnValueOnce({ mode: 'id', value: '/fibonacci/status' }); // statusTopicName

            mockParameterExtractor.extractRequiredNumber.mockReturnValue(5000);

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.getActionStatusByTopic.mockResolvedValue({
                goalId: 'goal-123',
                statusCode: 3,
                status: 'SUCCEEDED',
                text: 'Goal completed successfully',
                raw: { status_list: [] },
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json).toEqual({
                goalId: 'goal-123',
                serverName: '/fibonacci',
                status: 'SUCCEEDED',
                statusCode: 3,
                text: 'Goal completed successfully',
                rawStatusMessage: { status_list: [] },
                checkedAt: expect.any(String),
            });

            expect(mockRosBridgeService.connect).toHaveBeenCalled();
            expect(mockRosBridgeService.getActionStatusByTopic).toHaveBeenCalledWith(
                {},
                '/fibonacci/status',
                'action_msgs/GoalStatusArray',
                'goal-123',
                5000,
            );
            expect(mockRosBridgeService.close).toHaveBeenCalled();
        });

        it('should handle goal not found status', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNodeParameter: jest.fn(),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString
                .mockReturnValueOnce('goal-999')
                .mockReturnValueOnce('action_msgs/GoalStatusArray');

            (mockExecuteFunctions.getNodeParameter as jest.Mock)
                .mockReturnValueOnce({ mode: 'id', value: '/fibonacci' }) // serverName
                .mockReturnValueOnce({ mode: 'id', value: '/fibonacci/status' }); // statusTopicName

            mockParameterExtractor.extractRequiredNumber.mockReturnValue(5000);

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.getActionStatusByTopic.mockResolvedValue({
                goalId: 'goal-999',
                statusCode: -1,
                status: 'UNKNOWN',
                text: 'Goal not present in latest status message',
                raw: { status_list: [] },
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json.status).toBe('UNKNOWN');
            expect(result[0][0].json.statusCode).toBe(-1);
            expect(result[0][0].json.text).toBe('Goal not present in latest status message');
        });

        it('should handle connection errors with continueOnFail', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(true),
            } as unknown as IExecuteFunctions;

            mockRosBridgeService.connect.mockRejectedValue(new Error('Connection failed'));
            mockNodeErrorHandler.buildErrorOutput.mockReturnValue({ error: 'Connection failed' });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({ error: 'Connection failed' });
            expect(mockNodeErrorHandler.handle).not.toHaveBeenCalled();
        });

        it('should handle parameter validation errors', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation(() => {
                throw new Error('Invalid goal ID');
            });

            mockNodeErrorHandler.handle.mockImplementation(() => {
                throw new Error('Validation error');
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Validation error');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });
    });
});
