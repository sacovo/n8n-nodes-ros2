/**
 * Unit tests for RosTopicTrigger node
 */

import { RosTopicTrigger } from '../RosTopicTrigger.node';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import { ParameterExtractor } from '../../shared/utils/ParameterExtractor';
import type { ITriggerFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

// Mock the services
jest.mock('../../shared/services/RosBridgeService');
jest.mock('../../shared/utils/ParameterExtractor');
jest.mock('../../shared/utils/NodeErrorHandler');

const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;
const mockParameterExtractor = ParameterExtractor as jest.Mocked<typeof ParameterExtractor>;

describe('RosTopicTrigger', () => {
    let node: RosTopicTrigger;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosTopicTrigger();
    });

    describe('trigger', () => {
        it('should trigger on topic message successfully', async () => {
            const mockTriggerFunctions = {
                getCredentials: jest.fn().mockResolvedValue({}),
                emit: jest.fn(),
                getWorkflowStaticData: jest.fn().mockReturnValue({}),
                setWorkflowStaticData: jest.fn(),
            } as unknown as ITriggerFunctions;

            mockParameterExtractor.extractRequiredString
                .mockReturnValueOnce('/chatter')
                .mockReturnValueOnce('std_msgs/msg/String');
            mockParameterExtractor.extractRequiredNumber.mockReturnValue(1000);

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.subscribeToTopic.mockImplementation(async (ros, topic, type, callback) => {
                callback({ data: 'Hello from ROS!' });
                return () => { };
            });
            // Start the trigger
            await node.trigger.call(mockTriggerFunctions);

            // Wait for the message to be processed
            await new Promise(resolve => setTimeout(resolve, 50));

            expect(mockTriggerFunctions.emit).toHaveBeenCalledWith([
                [
                    {
                        json: {
                            topic: '/chatter',
                            messageType: 'std_msgs/msg/String',
                            message: { data: 'Hello from ROS!' },
                            rawMessage: { data: 'Hello from ROS!' },
                            receivedAt: expect.any(String),
                        },
                    },
                ],
            ]);

            expect(mockRosBridgeService.connect).toHaveBeenCalled();
            expect(mockRosBridgeService.subscribeToTopic).toHaveBeenCalledWith(
                {},
                '/chatter',
                'std_msgs/msg/String',
                expect.any(Function),
            );
        });

        it('should handle connection errors', async () => {
            const mockTriggerFunctions = {
                getCredentials: jest.fn().mockResolvedValue({}),
                emit: jest.fn(),
                getWorkflowStaticData: jest.fn().mockReturnValue({}),
                setWorkflowStaticData: jest.fn(),
            } as unknown as ITriggerFunctions;

            mockParameterExtractor.extractRequiredString
                .mockReturnValueOnce('/chatter')
                .mockReturnValueOnce('std_msgs/msg/String');
            mockParameterExtractor.extractRequiredNumber.mockReturnValue(1000);

            mockRosBridgeService.connect.mockRejectedValue(new Error('Connection failed'));

            await expect(node.trigger.call(mockTriggerFunctions)).rejects.toThrow('Connection failed');
        });

        it('should handle parameter validation errors', async () => {
            const mockTriggerFunctions = {
                getCredentials: jest.fn().mockResolvedValue({}),
                emit: jest.fn(),
                getWorkflowStaticData: jest.fn().mockReturnValue({}),
                setWorkflowStaticData: jest.fn(),
            } as unknown as ITriggerFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation(() => {
                throw new Error('Invalid topic name');
            });

            await expect(node.trigger.call(mockTriggerFunctions)).rejects.toThrow('Invalid topic name');
        });

        it('should handle subscription errors', async () => {
            const mockTriggerFunctions = {
                getCredentials: jest.fn().mockResolvedValue({}),
                emit: jest.fn(),
                getWorkflowStaticData: jest.fn().mockReturnValue({}),
                setWorkflowStaticData: jest.fn(),
            } as unknown as ITriggerFunctions;

            mockParameterExtractor.extractRequiredString
                .mockReturnValueOnce('/chatter')
                .mockReturnValueOnce('std_msgs/msg/String');
            mockParameterExtractor.extractRequiredNumber.mockReturnValue(1000);

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.subscribeToTopic.mockRejectedValue(new Error('Subscription failed'));

            await expect(node.trigger.call(mockTriggerFunctions)).rejects.toThrow('Subscription failed');
        });
    });
});
