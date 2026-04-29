/**
 * Unit tests for RosTopicPublish node
 */

import { RosTopicPublish } from '../RosTopicPublish.node';
import * as RosBridgeClient from '../../shared/RosBridgeClient';
import { ParameterExtractor } from '../../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../../shared/utils/NodeErrorHandler';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

// Mock the services
jest.mock('../../shared/RosBridgeClient');
jest.mock('../../shared/utils/ParameterExtractor');
jest.mock('../../shared/utils/NodeErrorHandler');

const mockRosBridgeClient = RosBridgeClient as jest.Mocked<typeof RosBridgeClient>;
const mockParameterExtractor = ParameterExtractor as jest.Mocked<typeof ParameterExtractor>;
const mockNodeErrorHandler = NodeErrorHandler as jest.Mocked<typeof NodeErrorHandler>;

import type { ILoadOptionsFunctions } from 'n8n-workflow';

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

                mockRosBridgeClient.connectRos.mockResolvedValue({} as unknown as Ros);
                mockRosBridgeClient.getRosTopics.mockResolvedValue({ topics: ['/topic1', '/topic2'], types: [] });
                mockRosBridgeClient.formatTopicListForN8n.mockReturnValue([
                    { name: '/topic1', value: '/topic1' },
                    { name: '/topic2', value: '/topic2' },
                ]);

                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const result = await node.methods.listSearch.getTopicsList.call(mockLoadOptionsFunctions, 'top');

                expect(result).toEqual({
                    results: [
                        { name: '/topic1', value: '/topic1' },
                        { name: '/topic2', value: '/topic2' },
                    ],
                });
                expect(mockRosBridgeClient.getRosTopics).toHaveBeenCalled();
                expect(mockRosBridgeClient.formatTopicListForN8n).toHaveBeenCalledWith(['/topic1', '/topic2'], 'top');
                expect(mockRosBridgeClient.closeRos).toHaveBeenCalled();
            });
        });

        describe('getDetectedType', () => {
            it('should return detected type list', async () => {
                const mockLoadOptionsFunctions = {
                    getNodeParameter: jest.fn().mockReturnValue('/topic1'),
                    getCredentials: jest.fn().mockResolvedValue({}),
                } as unknown as ILoadOptionsFunctions;

                mockRosBridgeClient.connectRos.mockResolvedValue({} as unknown as Ros);
                mockRosBridgeClient.getRosTopicType.mockResolvedValue('std_msgs/String');

                // eslint-disable-next-line @typescript-eslint/ban-ts-comment
                // @ts-ignore
                const result = await node.methods.listSearch.getDetectedType.call(mockLoadOptionsFunctions, 'std');

                expect(result).toEqual({
                    results: [
                        { name: 'Detected: std_msgs/String', value: 'std_msgs/String' },
                    ],
                });
                expect(mockRosBridgeClient.getRosTopicType).toHaveBeenCalledWith(expect.anything(), '/topic1');
                expect(mockRosBridgeClient.closeRos).toHaveBeenCalled();
            });

            it('should return empty list if filter does not match', async () => {
                const mockLoadOptionsFunctions = {
                    getNodeParameter: jest.fn().mockReturnValue('/topic1'),
                    getCredentials: jest.fn().mockResolvedValue({}),
                } as unknown as ILoadOptionsFunctions;

                mockRosBridgeClient.connectRos.mockResolvedValue({} as unknown as Ros);
                mockRosBridgeClient.getRosTopicType.mockResolvedValue('std_msgs/String');

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

            mockRosBridgeClient.connectRos.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeClient.publishRosTopic.mockResolvedValue(undefined);
            mockRosBridgeClient.closeRos.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json).toEqual({
                topic: '/chatter',
                messageType: 'std_msgs/msg/String',
                message: { data: 'Hello ROS!' },
                publishedAt: expect.any(String),
            });

            expect(mockRosBridgeClient.connectRos).toHaveBeenCalled();
            expect(mockRosBridgeClient.publishRosTopic).toHaveBeenCalledWith(
                {},
                '/chatter',
                'std_msgs/msg/String',
                { data: 'Hello ROS!' },
            );
            expect(mockRosBridgeClient.closeRos).toHaveBeenCalled();
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

            mockRosBridgeClient.connectRos.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeClient.publishRosTopic.mockRejectedValue(new Error('Publish failed'));
            mockRosBridgeClient.closeRos.mockImplementation(() => { });
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
