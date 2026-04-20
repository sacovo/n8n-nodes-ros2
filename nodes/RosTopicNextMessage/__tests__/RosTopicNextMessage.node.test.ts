/**
 * Unit tests for RosTopicNextMessage node
 */

import { RosTopicNextMessage } from '../RosTopicNextMessage.node';
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

describe('RosTopicNextMessage', () => {
    let node: RosTopicNextMessage;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosTopicNextMessage();
    });

    describe('execute', () => {
        it('should get next message successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString
                .mockReturnValueOnce('/chatter')
                .mockReturnValueOnce('std_msgs/msg/String');
            mockParameterExtractor.extractRequiredNumber.mockReturnValue(5000);

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.waitForTopicMessage.mockResolvedValue({
                message: { data: 'Hello ROS!' },
                raw: { data: 'Hello ROS!' },
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json).toEqual({
                topic: '/chatter',
                messageType: 'std_msgs/msg/String',
                message: { data: 'Hello ROS!' },
                rawMessage: { data: 'Hello ROS!' },
                receivedAt: expect.any(String),
            });

            expect(mockRosBridgeService.connect).toHaveBeenCalled();
            expect(mockRosBridgeService.waitForTopicMessage).toHaveBeenCalledWith(
                {},
                '/chatter',
                'std_msgs/msg/String',
                5000,
            );
            expect(mockRosBridgeService.close).toHaveBeenCalled();
        });

        it('should handle timeout errors with continueOnFail', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(true),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString
                .mockReturnValueOnce('/quiet_topic')
                .mockReturnValueOnce('std_msgs/msg/String');
            mockParameterExtractor.extractRequiredNumber.mockReturnValue(1000);

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.waitForTopicMessage.mockRejectedValue(new Error('Timeout waiting for message'));
            mockRosBridgeService.close.mockImplementation(() => { });
            mockNodeErrorHandler.buildErrorOutput.mockReturnValue({ error: 'Timeout waiting for message' });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({ error: 'Timeout waiting for message' });
            expect(mockNodeErrorHandler.handle).not.toHaveBeenCalled();
        });

        it('should handle parameter validation errors', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation(() => {
                throw new Error('Invalid topic name');
            });

            mockNodeErrorHandler.handle.mockImplementation(() => {
                throw new Error('Validation error');
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Validation error');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });

        it('should handle connection errors', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString
                .mockReturnValueOnce('/chatter')
                .mockReturnValueOnce('std_msgs/msg/String');
            mockParameterExtractor.extractRequiredNumber.mockReturnValue(5000);

            mockRosBridgeService.connect.mockRejectedValue(new Error('Connection failed'));

            mockNodeErrorHandler.handle.mockImplementation(() => {
                throw new Error('Connection error');
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Connection error');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });
    });
});
