/**
 * Unit tests for RosTopicPublish node
 */

import { RosTopicPublish } from '../RosTopicPublish.node';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import { RosApiService } from '../../shared/services/RosApiService';
import { RosN8nFormatter } from '../../shared/utils/RosN8nFormatter';
import { ParameterExtractor } from '../../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../../shared/utils/NodeErrorHandler';
import type { IExecuteFunctions, ILoadOptionsFunctions  } from 'n8n-workflow';
import type { Ros } from 'roslib';

// Mock the services
jest.mock('../../shared/services/RosBridgeService');
jest.mock('../../shared/services/RosApiService');
jest.mock('../../shared/utils/RosN8nFormatter');
jest.mock('../../shared/utils/ParameterExtractor');
jest.mock('../../shared/utils/NodeErrorHandler');

const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;
const mockRosApiService = RosApiService as jest.Mocked<typeof RosApiService>;
const mockRosN8nFormatter = RosN8nFormatter as jest.Mocked<typeof RosN8nFormatter>;
const mockParameterExtractor = ParameterExtractor as jest.Mocked<typeof ParameterExtractor>;
const mockNodeErrorHandler = NodeErrorHandler as jest.Mocked<typeof NodeErrorHandler>;


describe('RosTopicPublish', () => {
    let node: RosTopicPublish;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosTopicPublish();
    });

    describe('listSearch', () => {
        describe('getTopicsList', () => {
            it('should return formatted topic list', async () => {
                const mockLoadOptionsFunctions = {
                    getCredentials: jest.fn().mockResolvedValue({}),
                } as unknown as ILoadOptionsFunctions;

                mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
                mockRosApiService.getTopics.mockResolvedValue({ topics: ['/topic1', '/topic2'], types: [] });
                mockRosN8nFormatter.formatTopicListForN8n.mockReturnValue([
                    { name: '/Topic1', value: '/topic1' },
                    { name: '/Topic2', value: '/topic2' },
                ]);

                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const result = await node.methods.listSearch.getTopicsList.call(mockLoadOptionsFunctions, 'top');

                expect(result).toEqual({
                    results: [
                        { name: '/Topic1', value: '/topic1' },
                        { name: '/Topic2', value: '/topic2' },
                    ],
                });
                expect(mockRosApiService.getTopics).toHaveBeenCalled();
                expect(mockRosN8nFormatter.formatTopicListForN8n).toHaveBeenCalledWith(['/topic1', '/topic2'], 'top');
                expect(mockRosBridgeService.close).toHaveBeenCalled();
            });
        });

        describe('getDetectedType', () => {
            it('should return detected type list', async () => {
                const mockLoadOptionsFunctions = {
                    getNodeParameter: jest.fn().mockReturnValue('/topic1'),
                    getCredentials: jest.fn().mockResolvedValue({}),
                } as unknown as ILoadOptionsFunctions;

                mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
                mockRosApiService.getTopicType.mockResolvedValue('std_msgs/String');

                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const result = await node.methods.listSearch.getDetectedType.call(mockLoadOptionsFunctions, 'std');

                expect(result).toEqual({
                    results: [
                        { name: 'Detected: std_msgs/String', value: 'std_msgs/String' },
                    ],
                });
                expect(mockRosApiService.getTopicType).toHaveBeenCalledWith(expect.anything(), '/topic1');
                expect(mockRosBridgeService.close).toHaveBeenCalled();
            });

            it('should return empty list if filter does not match', async () => {
                const mockLoadOptionsFunctions = {
                    getNodeParameter: jest.fn().mockReturnValue('/topic1'),
                    getCredentials: jest.fn().mockResolvedValue({}),
                } as unknown as ILoadOptionsFunctions;

                mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
                mockRosApiService.getTopicType.mockResolvedValue('std_msgs/String');

                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const result = await node.methods.listSearch.getDetectedType.call(mockLoadOptionsFunctions, 'nomatch');

                expect(result).toEqual({ results: [] });
            });
        });
    });

    describe('execute', () => {
        it('should publish message successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name: string) => {
                    if (name === 'topicName') return '/chatter';
                    if (name === 'messageType') return 'std_msgs/msg/String';
                    if (name === 'messageInputMode') return 'raw';
                    if (name === 'messageJson') return '{"data":"Hello ROS!"}';
                    return undefined;
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractJsonParameter.mockReturnValue({ data: 'Hello ROS!' });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.publishTopic.mockResolvedValue(undefined);
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json).toEqual({
                topic: '/chatter',
                messageType: 'std_msgs/msg/String',
                message: { data: 'Hello ROS!' },
                publishedAt: expect.any(String),
            });

            expect(mockRosBridgeService.connect).toHaveBeenCalled();
            expect(mockRosBridgeService.publishTopic).toHaveBeenCalledWith(
                {},
                '/chatter',
                'std_msgs/msg/String',
                { data: 'Hello ROS!' },
                undefined,
                undefined,
            );
            expect(mockRosBridgeService.close).toHaveBeenCalled();
        });

        it('should advertise topic only when operation is advertise', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name: string) => {
                    if (name === 'operation') return 'advertise';
                    if (name === 'topicName') return '/chatter';
                    if (name === 'messageType') return 'std_msgs/msg/String';
                    return undefined;
                }),
            } as unknown as IExecuteFunctions;

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.advertiseTopic.mockResolvedValue(undefined);
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json).toEqual({
                topic: '/chatter',
                messageType: 'std_msgs/msg/String',
                advertisedAt: expect.any(String),
            });

            expect(mockRosBridgeService.connect).toHaveBeenCalled();
            expect(mockRosBridgeService.advertiseTopic).toHaveBeenCalledWith(
                {},
                '/chatter',
                'std_msgs/msg/String',
            );
            expect(mockRosBridgeService.publishTopic).not.toHaveBeenCalled();
            expect(mockRosBridgeService.close).toHaveBeenCalled();
        });

        it('should publish message with custom options (discoveryDelay and burst)', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name: string) => {
                    if (name === 'topicName') return '/chatter';
                    if (name === 'messageType') return 'std_msgs/msg/String';
                    if (name === 'messageInputMode') return 'raw';
                    if (name === 'messageJson') return '{"data":"Hello ROS!"}';
                    if (name === 'options') return { discoveryDelay: 1000, burstOption: true, burstNumber: 3, burstWait: 200 };
                    return undefined;
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractJsonParameter.mockReturnValue({ data: 'Hello ROS!' });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.publishTopic.mockResolvedValue(undefined);
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(1);
            expect(mockRosBridgeService.publishTopic).toHaveBeenCalledWith(
                {},
                '/chatter',
                'std_msgs/msg/String',
                { data: 'Hello ROS!' },
                1000,
                { number: 3, wait: 200 },
            );
        });

        it('should handle publish errors with continueOnFail', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(true),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name: string) => {
                    if (name === 'topicName') return '/invalid_topic';
                    if (name === 'messageType') return 'std_msgs/msg/String';
                    if (name === 'messageInputMode') return 'raw';
                    if (name === 'messageJson') return '{"data":"test"}';
                    return undefined;
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractJsonParameter.mockReturnValue({ data: 'test' });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.publishTopic.mockRejectedValue(new Error('Publish failed'));
            mockRosBridgeService.close.mockImplementation(() => { });
            mockNodeErrorHandler.shouldReturnErrorOutput.mockImplementation((ctx) => ctx.continueOnFail());
            mockNodeErrorHandler.buildErrorOutput.mockReturnValue({ error: 'Publish failed' });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({ error: 'Publish failed' });
            expect(mockNodeErrorHandler.handle).not.toHaveBeenCalled();
        });

        it('should handle parameter validation errors', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name: string) => {
                    if (name === 'topicName') {
                        throw new Error('Invalid topic name');
                    }
                    return undefined;
                }),
            } as unknown as IExecuteFunctions;

            mockNodeErrorHandler.handle.mockImplementation(() => {
                throw new Error('Validation error');
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Validation error');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });

        it('should handle invalid JSON message parameters', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name: string) => {
                    if (name === 'topicName') return '/test_topic';
                    if (name === 'messageType') return 'std_msgs/msg/String';
                    if (name === 'messageInputMode') return 'raw';
                    if (name === 'messageJson') return '{"invalidJson":}';
                    return undefined;
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractJsonParameter.mockImplementation(() => {
                throw new Error('Invalid JSON format');
            });

            mockNodeErrorHandler.handle.mockImplementation(() => {
                throw new Error('Parameter error');
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Parameter error');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });
    });
});
