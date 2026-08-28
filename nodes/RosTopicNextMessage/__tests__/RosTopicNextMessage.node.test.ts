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
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'topicName') return '/chatter';
                    if (name === 'messageType') return 'std_msgs/msg/String';
                    return '';
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredNumber.mockReturnValue(5000);

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.waitForTopicMessage.mockResolvedValue({
                data: 'Hello ROS!'
            });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json).toEqual({
                topic: '/chatter',
                messageType: 'std_msgs/msg/String',
                message: { data: 'Hello ROS!' },
                receivedAt: expect.any(String),
            });

            expect(mockRosBridgeService.connect).toHaveBeenCalled();
            expect(mockRosBridgeService.waitForTopicMessage).toHaveBeenCalledWith(
                {},
                '/chatter',
                'std_msgs/msg/String',
                5000,
                expect.any(Function),
            );
        });

        it('should normalize legacy expression conditions and filter messages (regression for pre-0.2.0 exports)', async () => {
            const legacyConditions = {
                options: { caseSensitive: true },
                combinator: 'and',
                conditions: [
                    {
                        leftValue: '={{ $json.message.data }}',
                        rightValue: 3,
                        operator: { type: 'number', operation: 'equals' },
                    },
                ],
            };

            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                evaluateExpression: jest.fn(),
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'topicName') return '/act_value';
                    if (name === 'messageType') return 'std_msgs/msg/Float32';
                    if (name === 'conditions') return legacyConditions;
                    return '';
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredNumber.mockReturnValue(5000);

            let filterCallback: ((message: Record<string, unknown>) => boolean) | undefined;
            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.waitForTopicMessage.mockImplementation(async (ros, topic, type, timeout, callback) => {
                filterCallback = callback;
                return { data: 3 };
            });

            await node.execute.call(mockExecuteFunctions);

            // The stored n8n expression must not be evaluated by the engine…
            expect(mockExecuteFunctions.getNodeParameter).toHaveBeenCalledWith(
                'conditions', 0, {}, { rawExpressions: true },
            );
            // …but converted to a plain path that filters arriving messages
            expect(filterCallback!({ data: 3 })).toBe(true);
            expect(filterCallback!({ data: 2 })).toBe(false);
        });

        it('should handle timeout errors with continueOnFail', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(true),
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'topicName') return '/quiet_topic';
                    if (name === 'messageType') return 'std_msgs/msg/String';
                    return '';
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredNumber.mockReturnValue(1000);

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.waitForTopicMessage.mockRejectedValue(new Error('Timeout waiting for message'));
            mockNodeErrorHandler.shouldReturnErrorOutput.mockImplementation((ctx) => ctx.continueOnFail());
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
                getNodeParameter: jest.fn().mockImplementation(() => {
                    throw new Error('Invalid topic name');
                }),
            } as unknown as IExecuteFunctions;

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
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'topicName') return '/chatter';
                    if (name === 'messageType') return 'std_msgs/msg/String';
                    return '';
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredNumber.mockReturnValue(5000);

            mockRosBridgeService.connect.mockRejectedValue(new Error('Connection failed'));

            mockNodeErrorHandler.handle.mockImplementation(() => {
                throw new Error('Connection error');
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Connection error');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });

        it('should still listen with a read-only credential', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({ readOnly: true }),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({ name: 'ROS2 Topic Next Message', type: 'rosTopicNextMessage' }),
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'topicName') return '/chatter';
                    if (name === 'messageType') return 'std_msgs/msg/String';
                    return '';
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredNumber.mockReturnValue(5000);
            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.waitForTopicMessage.mockResolvedValue({ data: 'Hello' });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(mockRosBridgeService.waitForTopicMessage).toHaveBeenCalled();
            expect(result[0][0].json).toMatchObject({ message: { data: 'Hello' } });
        });
    });
});
