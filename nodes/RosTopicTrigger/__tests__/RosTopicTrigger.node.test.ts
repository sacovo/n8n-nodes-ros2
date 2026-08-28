/**
 * Unit tests for RosTopicTrigger node
 */

import { RosTopicTrigger } from '../RosTopicTrigger.node';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import type { ITriggerFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

// Mock the services
jest.mock('../../shared/services/RosBridgeService');

const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;

function buildTriggerFunctions(parameters: Record<string, unknown>): ITriggerFunctions {
    return {
        getCredentials: jest.fn().mockResolvedValue({}),
        emit: jest.fn(),
        getNodeParameter: jest
            .fn()
            .mockImplementation((name: string, fallback: unknown) =>
                name in parameters ? parameters[name] : fallback,
            ),
        getWorkflowStaticData: jest.fn().mockReturnValue({}),
        setWorkflowStaticData: jest.fn(),
        getNode: jest.fn().mockReturnValue({ name: 'ROS2 Topic Trigger', type: 'rosTopicTrigger' }),
    } as unknown as ITriggerFunctions;
}

function buildMockRos(): Ros {
    return { once: jest.fn(), on: jest.fn() } as unknown as Ros;
}

describe('RosTopicTrigger', () => {
    let node: RosTopicTrigger;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosTopicTrigger();
    });

    describe('trigger', () => {
        it('should trigger on topic message successfully', async () => {
            const mockTriggerFunctions = buildTriggerFunctions({
                topicName: '/chatter',
                messageType: 'std_msgs/msg/String',
            });

            mockRosBridgeService.connect.mockResolvedValue(buildMockRos());
            mockRosBridgeService.subscribeToTopic.mockImplementation(async (ros, topic, type, callback) => {
                callback({ data: 'Hello from ROS!' });
                return () => {};
            });
            // Start the trigger
            await node.trigger.call(mockTriggerFunctions);

            // Wait for the message to be processed
            await new Promise((resolve) => setTimeout(resolve, 50));

            expect(mockTriggerFunctions.emit).toHaveBeenCalledWith([
                [
                    {
                        json: {
                            topic: '/chatter',
                            messageType: 'std_msgs/msg/String',
                            message: { data: 'Hello from ROS!' },
                            receivedAt: expect.any(String),
                        },
                    },
                ],
            ]);

            expect(mockRosBridgeService.connect).toHaveBeenCalled();
            expect(mockRosBridgeService.subscribeToTopic).toHaveBeenCalledWith(
                expect.anything(),
                '/chatter',
                'std_msgs/msg/String',
                expect.any(Function),
            );
        });

        it('should emit only the plain message when includeMetadata is false', async () => {
            const mockTriggerFunctions = buildTriggerFunctions({
                topicName: '/chatter',
                messageType: 'std_msgs/msg/String',
                includeMetadata: false,
            });

            mockRosBridgeService.connect.mockResolvedValue(buildMockRos());
            mockRosBridgeService.subscribeToTopic.mockImplementation(async (ros, topic, type, callback) => {
                callback({ data: 'Hello from ROS!' });
                return () => {};
            });

            await node.trigger.call(mockTriggerFunctions);

            expect(mockTriggerFunctions.emit).toHaveBeenCalledWith([[{ json: { data: 'Hello from ROS!' } }]]);
        });

        it('should only emit messages matching the configured conditions', async () => {
            const mockTriggerFunctions = buildTriggerFunctions({
                topicName: '/chatter',
                messageType: 'std_msgs/msg/String',
                conditions: {
                    options: { caseSensitive: false },
                    combinator: 'and',
                    conditions: [
                        {
                            leftValue: 'data',
                            rightValue: 'important',
                            operator: { operation: 'contains', type: 'string' },
                        },
                    ],
                },
            });

            mockRosBridgeService.connect.mockResolvedValue(buildMockRos());
            mockRosBridgeService.subscribeToTopic.mockImplementation(async (ros, topic, type, callback) => {
                callback({ data: 'boring message' });
                callback({ data: 'IMPORTANT message' });
                return () => {};
            });

            await node.trigger.call(mockTriggerFunctions);

            expect(mockTriggerFunctions.emit).toHaveBeenCalledTimes(1);
            expect(mockTriggerFunctions.emit).toHaveBeenCalledWith([
                [
                    {
                        json: expect.objectContaining({
                            message: { data: 'IMPORTANT message' },
                        }),
                    },
                ],
            ]);
        });

        it('should handle connection errors', async () => {
            const mockTriggerFunctions = buildTriggerFunctions({
                topicName: '/chatter',
                messageType: 'std_msgs/msg/String',
            });

            mockRosBridgeService.connect.mockRejectedValue(new Error('Connection failed'));

            await expect(node.trigger.call(mockTriggerFunctions)).rejects.toThrow('Connection failed');
        });

        it('should handle parameter validation errors', async () => {
            const mockTriggerFunctions = {
                getCredentials: jest.fn().mockResolvedValue({}),
                emit: jest.fn(),
                getNodeParameter: jest.fn().mockImplementation(() => {
                    throw new Error('Invalid topic name');
                }),
                getNode: jest.fn().mockReturnValue({ name: 'ROS2 Topic Trigger', type: 'rosTopicTrigger' }),
            } as unknown as ITriggerFunctions;

            await expect(node.trigger.call(mockTriggerFunctions)).rejects.toThrow('Invalid topic name');
        });

        it('should handle subscription errors', async () => {
            const mockTriggerFunctions = buildTriggerFunctions({
                topicName: '/chatter',
                messageType: 'std_msgs/msg/String',
            });

            mockRosBridgeService.connect.mockResolvedValue(buildMockRos());
            mockRosBridgeService.subscribeToTopic.mockRejectedValue(new Error('Subscription failed'));

            await expect(node.trigger.call(mockTriggerFunctions)).rejects.toThrow('Subscription failed');
        });

        it('should resubscribe after the connection closes', async () => {
            const mockTriggerFunctions = buildTriggerFunctions({
                topicName: '/chatter',
                messageType: 'std_msgs/msg/String',
            });

            jest.useFakeTimers();
            try {
                const closeHandlers: Array<() => void> = [];
                const ros = {
                    once: jest.fn().mockImplementation((event: string, handler: () => void) => {
                        if (event === 'close') {
                            closeHandlers.push(handler);
                        }
                    }),
                } as unknown as Ros;

                mockRosBridgeService.connect.mockResolvedValue(ros);
                const unsubscribe = jest.fn();
                mockRosBridgeService.subscribeToTopic.mockResolvedValue(unsubscribe);

                const result = await node.trigger.call(mockTriggerFunctions);
                expect(mockRosBridgeService.subscribeToTopic).toHaveBeenCalledTimes(1);

                // Simulate the websocket dropping
                closeHandlers[0]();
                await jest.advanceTimersByTimeAsync(6000);

                expect(mockRosBridgeService.connect).toHaveBeenCalledTimes(2);
                expect(mockRosBridgeService.subscribeToTopic).toHaveBeenCalledTimes(2);

                await result.closeFunction?.();
            } finally {
                jest.useRealTimers();
            }
        });

        it('should still subscribe with a read-only credential', async () => {
            const mockTriggerFunctions = buildTriggerFunctions({
                topicName: '/chatter',
                messageType: 'std_msgs/msg/String',
            });
            (mockTriggerFunctions.getCredentials as jest.Mock).mockResolvedValue({ readOnly: true });

            mockRosBridgeService.connect.mockResolvedValue(buildMockRos());
            mockRosBridgeService.subscribeToTopic.mockResolvedValue(() => {});

            await node.trigger.call(mockTriggerFunctions);

            expect(mockRosBridgeService.subscribeToTopic).toHaveBeenCalledWith(
                expect.anything(),
                '/chatter',
                'std_msgs/msg/String',
                expect.any(Function),
            );
        });
    });
});
