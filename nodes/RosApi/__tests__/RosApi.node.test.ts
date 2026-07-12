/**
 * Unit tests for RosApi node
 */

import { RosApi } from '../RosApi.node';
import { RosApiService } from '../../shared/services/RosApiService';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import { ParameterExtractor } from '../../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../../shared/utils/NodeErrorHandler';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

// Mock the services
jest.mock('../../shared/services/RosBridgeService');
jest.mock('../../shared/services/RosApiService');
jest.mock('../../shared/utils/ParameterExtractor');
jest.mock('../../shared/utils/NodeErrorHandler');

const mockRosApiService = RosApiService as jest.Mocked<typeof RosApiService>;
const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;
const mockParameterExtractor = ParameterExtractor as jest.Mocked<typeof ParameterExtractor>;
const mockNodeErrorHandler = NodeErrorHandler as jest.Mocked<typeof NodeErrorHandler>;

describe('RosApi', () => {
    let node: RosApi;

    beforeEach(() => {
        jest.resetAllMocks();
        node = new RosApi();
    });

    describe('execute', () => {
        it('should get topics successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'topic';
                if (name === 'operation') return 'list';
                return '';
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getTopics.mockResolvedValue({
                topics: ['/chatter', '/cmd_vel'],
                types: ['std_msgs/String', 'geometry_msgs/Twist'],
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json).toEqual({
                operation: 'list',
                resource: 'topic',
                topics: ['/chatter', '/cmd_vel'],
                types: ['std_msgs/String', 'geometry_msgs/Twist'],
                retrievedAt: expect.any(String),
            });

            expect(mockRosBridgeService.connect).toHaveBeenCalled();
            expect(mockRosApiService.getTopics).toHaveBeenCalled();
            expect(mockRosBridgeService.close).toHaveBeenCalled();
        });

        it('should get topics filtered by grep pattern successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'topic';
                if (name === 'operation') return 'list';
                return '';
            });

            mockParameterExtractor.extractOptionalString.mockImplementation((node, index, name) => {
                if (name === 'grep') return 'chat';
                return undefined;
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getTopics.mockResolvedValue({
                topics: ['/chatter', '/cmd_vel', '/chatter_debug'],
                types: ['std_msgs/String', 'geometry_msgs/Twist', 'std_msgs/String'],
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json).toEqual({
                operation: 'list',
                resource: 'topic',
                topics: ['/chatter', '/chatter_debug'],
                types: ['std_msgs/String', 'std_msgs/String'],
                retrievedAt: expect.any(String),
            });
        });

        it('should get topics filtered by grep regex pattern successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'topic';
                if (name === 'operation') return 'list';
                return '';
            });

            mockParameterExtractor.extractOptionalString.mockImplementation((node, index, name) => {
                if (name === 'grep') return '^/cmd_.*$';
                return undefined;
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getTopics.mockResolvedValue({
                topics: ['/chatter', '/cmd_vel', '/chatter_debug'],
                types: ['std_msgs/String', 'geometry_msgs/Twist', 'std_msgs/String'],
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                operation: 'list',
                resource: 'topic',
                topics: ['/cmd_vel'],
                types: ['geometry_msgs/Twist'],
                retrievedAt: expect.any(String),
            });
        });

        it('should fallback to plain substring case-insensitive match when grep regex is invalid', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'topic';
                if (name === 'operation') return 'list';
                return '';
            });

            mockParameterExtractor.extractOptionalString.mockImplementation((node, index, name) => {
                if (name === 'grep') return 'chatter[';
                return undefined;
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getTopics.mockResolvedValue({
                topics: ['/chatter', '/cmd_vel', '/chatter_debug', '/chatter['],
                types: ['std_msgs/String', 'geometry_msgs/Twist', 'std_msgs/String', 'std_msgs/String'],
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                operation: 'list',
                resource: 'topic',
                topics: ['/chatter['],
                types: ['std_msgs/String'],
                retrievedAt: expect.any(String),
            });
        });

        it('should get topics as a combined array when combineTopicsAndTypes is enabled', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockReturnValue(true),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'topic';
                if (name === 'operation') return 'list';
                return '';
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getTopics.mockResolvedValue({
                topics: ['/chatter', '/cmd_vel'],
                types: ['std_msgs/String', 'geometry_msgs/Twist'],
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                operation: 'list',
                resource: 'topic',
                topics: [
                    { name: '/chatter', type: 'std_msgs/String' },
                    { name: '/cmd_vel', type: 'geometry_msgs/Twist' },
                ],
                retrievedAt: expect.any(String),
            });
        });

        it('should filter combined topics by grep pattern when combineTopicsAndTypes is enabled', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockReturnValue(true),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'topic';
                if (name === 'operation') return 'list';
                return '';
            });

            mockParameterExtractor.extractOptionalString.mockImplementation((node, index, name) => {
                if (name === 'grep') return 'chat';
                return undefined;
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getTopics.mockResolvedValue({
                topics: ['/chatter', '/cmd_vel', '/chatter_debug'],
                types: ['std_msgs/String', 'geometry_msgs/Twist', 'std_msgs/String'],
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                operation: 'list',
                resource: 'topic',
                topics: [
                    { name: '/chatter', type: 'std_msgs/String' },
                    { name: '/chatter_debug', type: 'std_msgs/String' },
                ],
                retrievedAt: expect.any(String),
            });
        });

        it('should get services successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'service';
                if (name === 'operation') return 'list';
                return '';
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getServices.mockResolvedValue(['service1', 'service2']);
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                operation: 'list',
                resource: 'service',
                services: ['service1', 'service2'],
                retrievedAt: expect.any(String),
            });

            expect(mockRosApiService.getServices).toHaveBeenCalled();
        });

        it('should get nodes successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'node';
                if (name === 'operation') return 'list';
                return '';
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getNodes.mockResolvedValue(['node1', 'node2']);
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                operation: 'list',
                resource: 'node',
                nodes: ['node1', 'node2'],
                retrievedAt: expect.any(String),
            });

            expect(mockRosApiService.getNodes).toHaveBeenCalled();
        });

        it('should get action servers successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'action';
                if (name === 'operation') return 'list';
                return '';
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getActionServers.mockResolvedValue(['action1', 'action2']);
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                operation: 'list',
                resource: 'action',
                actionServers: ['action1', 'action2'],
                retrievedAt: expect.any(String),
            });

            expect(mockRosApiService.getActionServers).toHaveBeenCalled();
        });

        it('should handle API errors with continueOnFail', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(true),
                getNode: jest.fn().mockReturnValue({}),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockReturnValue('topics');

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getTopics.mockRejectedValue(new Error('ROS API unavailable'));
            mockRosBridgeService.close.mockImplementation(() => { });
            mockNodeErrorHandler.buildErrorOutput.mockReturnValue({ error: 'ROS API unavailable' });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({ error: 'ROS API unavailable' });
            expect(mockNodeErrorHandler.handle).not.toHaveBeenCalled();
        });

        it('should handle parameter validation errors', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation(() => {
                throw new Error('Invalid operation');
            });

            mockNodeErrorHandler.handle.mockImplementation(() => {
                throw new Error('Validation error');
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Validation error');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });

        it('should handle unsupported operations', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'topic';
                if (name === 'operation') return 'unsupported_operation';
                return '';
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.close.mockImplementation(() => { });

            mockNodeErrorHandler.handle.mockImplementation((context, error: unknown) => {
                throw new Error((error as { message: string }).message);
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Unsupported operation: unsupported_operation:topic!');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });

        it('should support all operations defined in the node properties', async () => {
            const resourceProperty = node.description.properties.find(p => p.name === 'resource');
            /* eslint-disable  @typescript-eslint/no-explicit-any */
            const resourceOptions = resourceProperty?.options?.map(o => (o as any).value as string) || [];

            const combinations: { resource: string, operation: string }[] = [];

            for (const resource of resourceOptions) {
                const operationProperties = node.description.properties.filter(
                    p => p.name === 'operation' && (p.displayOptions?.show?.resource as string[] | undefined)?.includes(resource)
                );
                for (const opProp of operationProperties) {
                    /* eslint-disable  @typescript-eslint/no-explicit-any */
                    const opOptions = opProp.options?.map(o => (o as any).value as string) || [];
                    for (const operation of opOptions) {
                        combinations.push({ resource, operation });
                    }
                }
            }

            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            for (const { resource, operation } of combinations) {
                mockParameterExtractor.extractRequiredString.mockImplementation((n, idx, name) => {
                    if (name === 'resource') return resource;
                    if (name === 'operation') return operation;
                    return '{}'; // Provide a generic fallback for other parameters like parameterValue
                });

                mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
                mockRosBridgeService.close.mockImplementation(() => { });

                mockNodeErrorHandler.handle.mockImplementation((context, error: any) => {
                    throw error;
                });

                // Mock all possible backend calls to prevent internal application errors
                mockRosApiService.getTopics.mockResolvedValue({ topics: [], types: [] });
                mockRosApiService.getServices.mockResolvedValue([]);
                mockRosApiService.getNodes.mockResolvedValue([]);
                mockRosApiService.getActionServers.mockResolvedValue([]);
                mockRosApiService.getParams.mockResolvedValue([]);
                mockRosApiService.getTopicType.mockResolvedValue('std_msgs/String');
                mockRosApiService.getNodeDetails.mockResolvedValue({} as any);
                mockRosApiService.getParam.mockResolvedValue({});
                mockRosApiService.setParam.mockResolvedValue(undefined);
                mockRosApiService.getServiceType.mockResolvedValue('std_srvs/Trigger');
                mockRosApiService.getActionType.mockResolvedValue('test_msgs/action/Fibonacci');
                mockRosApiService.getMessageDetails.mockResolvedValue([] as any);
                mockRosApiService.getTopicsForType.mockResolvedValue([]);
                mockRosApiService.getServicesForType.mockResolvedValue([]);

                try {
                    await node.execute.call(mockExecuteFunctions);
                } catch (e: any) {
                    if (e.message && e.message.includes('Unsupported operation')) {
                        throw new Error(`Combination missing in runOperation switch statement: ${operation}:${resource}`);
                    }
                    // Ignore parameter validation errors
                }
            }
        });

        it('should include description and raw definition on getType:topic when the options are enabled', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'includeDescription') return true;
                    if (name === 'includeRawDefinition') return true;
                    return false;
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'topic';
                if (name === 'operation') return 'getType';
                if (name === 'topicName') return '/cmd_vel';
                return '';
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getTopicType.mockResolvedValue('geometry_msgs/msg/Twist');
            mockRosApiService.getInterfaceDescription.mockResolvedValue('Drive command for the rover base');
            mockRosApiService.getTopicRawDefinition.mockResolvedValue('Vector3 linear # m/s');
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toMatchObject({
                topicName: '/cmd_vel',
                topicType: 'geometry_msgs/msg/Twist',
                description: 'Drive command for the rover base',
                rawDefinition: 'Vector3 linear # m/s',
            });
            expect(mockRosApiService.getInterfaceDescription).toHaveBeenCalledWith(expect.anything(), '/cmd_vel');
            expect(mockRosApiService.getTopicRawDefinition).toHaveBeenCalledWith(expect.anything(), '/cmd_vel', 'geometry_msgs/msg/Twist');
        });

        it('should not fetch documentation on getType:topic when the options are off', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'topic';
                if (name === 'operation') return 'getType';
                if (name === 'topicName') return '/cmd_vel';
                return '';
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getTopicType.mockResolvedValue('geometry_msgs/msg/Twist');
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).not.toHaveProperty('description');
            expect(result[0][0].json).not.toHaveProperty('rawDefinition');
            expect(mockRosApiService.getInterfaceDescription).not.toHaveBeenCalled();
            expect(mockRosApiService.getTopicRawDefinition).not.toHaveBeenCalled();
        });

        it('should include description on getType:service when enabled', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name) => name === 'includeDescription'),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'service';
                if (name === 'operation') return 'getType';
                if (name === 'serviceName') return '/set_value';
                return '';
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getServiceType.mockResolvedValue('fhnw_interfaces/srv/SetValue');
            mockRosApiService.getInterfaceDescription.mockResolvedValue('Sets the turntable target position in mm');
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toMatchObject({
                serviceName: '/set_value',
                serviceType: 'fhnw_interfaces/srv/SetValue',
                description: 'Sets the turntable target position in mm',
            });
        });

        it('should get topic definition successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'resource') return 'topic';
                    if (name === 'operation') return 'getDefinition';
                    if (name === 'messageType') return 'std_msgs/String';
                    return '';
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'topic';
                if (name === 'operation') return 'getDefinition';
                return '';
            });
            mockParameterExtractor.extractOptionalString.mockImplementation((node, index, name) => {
                if (name === 'messageType') return 'std_msgs/String';
                return undefined;
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getMessageDetails.mockResolvedValue([
                {
                    type: 'std_msgs/String',
                    fieldnames: ['data'],
                    fieldtypes: ['string'],
                    fieldarraylen: [-1],
                    examples: [],
                }
            ]);
            mockRosApiService.expandRootTypeDef.mockReturnValue({ data: 'string' });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toMatchObject({
                operation: 'getDefinition',
                resource: 'topic',
                messageType: 'std_msgs/String',
                definition: { data: 'string' },
            });
        });

        it('should get node definition successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'node';
                if (name === 'operation') return 'getDefinition';
                if (name === 'nodeName') return '/talker';
                return '';
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getNodeDefinition.mockResolvedValue({
                publishing: [
                    { name: '/chatter', type: 'std_msgs/msg/String', definition: { data: 'string' } },
                ],
                subscribing: [],
                services: [
                    {
                        name: '/talker/describe_parameters',
                        type: 'rcl_interfaces/srv/DescribeParameters',
                        request: { names: ['string'] },
                        response: { descriptors: [{ name: 'string' }] },
                    },
                ],
                actions: [
                    {
                        name: '/fibonacci',
                        type: 'test_msgs/action/Fibonacci',
                        goal: { order: 'int32' },
                        result: { sequence: ['int32'] },
                        feedback: { sequence: ['int32'] },
                    },
                ],
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toMatchObject({
                operation: 'getDefinition',
                resource: 'node',
                nodeName: '/talker',
                publishing: [
                    { name: '/chatter', type: 'std_msgs/msg/String', definition: { data: 'string' } },
                ],
                subscribing: [],
                services: [
                    {
                        name: '/talker/describe_parameters',
                        type: 'rcl_interfaces/srv/DescribeParameters',
                        request: { names: ['string'] },
                        response: { descriptors: [{ name: 'string' }] },
                    },
                ],
                actions: [
                    {
                        name: '/fibonacci',
                        type: 'test_msgs/action/Fibonacci',
                        goal: { order: 'int32' },
                        result: { sequence: ['int32'] },
                        feedback: { sequence: ['int32'] },
                    },
                ],
            });
            expect(mockRosApiService.getNodeDefinition).toHaveBeenCalledWith(expect.anything(), '/talker');
        });

        it('should get service definition successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'resource') return 'service';
                    if (name === 'operation') return 'getDefinition';
                    if (name === 'messageType') return 'std_srvs/Trigger';
                    return '';
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'service';
                if (name === 'operation') return 'getDefinition';
                return '';
            });
            mockParameterExtractor.extractOptionalString.mockImplementation((node, index, name) => {
                if (name === 'messageType') return 'std_srvs/Trigger';
                return undefined;
            });
            
            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getServiceRequestDetails.mockResolvedValue([]);
            mockRosApiService.getServiceResponseDetails.mockResolvedValue([]);
            mockRosApiService.expandRootTypeDef.mockReturnValueOnce({}).mockReturnValueOnce({ success: 'bool', message: 'string' });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toMatchObject({
                operation: 'getDefinition',
                resource: 'service',
                serviceType: 'std_srvs/Trigger',
                request: {},
                response: { success: 'bool', message: 'string' },
            });
        });

        it('should get action definition successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'action';
                if (name === 'operation') return 'getDefinition';
                return '';
            });
            mockParameterExtractor.extractOptionalString.mockImplementation((node, index, name) => {
                if (name === 'actionName') return '/fibonacci';
                return undefined;
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getActionType.mockResolvedValue('test_msgs/action/Fibonacci');
            mockRosApiService.getActionGoalDetails.mockResolvedValue([]);
            mockRosApiService.getActionResultDetails.mockResolvedValue([]);
            mockRosApiService.getActionFeedbackDetails.mockResolvedValue([]);
            mockRosApiService.expandRootTypeDef
                .mockReturnValueOnce({ order: 'int32' })
                .mockReturnValueOnce({ sequence: ['int32'] })
                .mockReturnValueOnce({ partial_sequence: ['int32'] });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toMatchObject({
                operation: 'getDefinition',
                resource: 'action',
                actionType: 'test_msgs/action/Fibonacci',
                goal: { order: 'int32' },
                result: { sequence: ['int32'] },
                feedback: { partial_sequence: ['int32'] },
            });
            expect(mockRosApiService.getActionType).toHaveBeenCalledWith(expect.anything(), '/fibonacci');
        });

        it('should get action type with description successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name) => name === 'includeDescription'),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'action';
                if (name === 'operation') return 'getType';
                if (name === 'actionName') return '/fibonacci';
                return '';
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getActionType.mockResolvedValue('test_msgs/action/Fibonacci');
            mockRosApiService.getInterfaceDescription.mockResolvedValue('Computes the Fibonacci sequence up to the given order');
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toMatchObject({
                actionName: '/fibonacci',
                actionType: 'test_msgs/action/Fibonacci',
                description: 'Computes the Fibonacci sequence up to the given order',
            });
            expect(mockRosApiService.getInterfaceDescription).toHaveBeenCalledWith(expect.anything(), '/fibonacci');
        });

        it('should fail getType:action when the action type cannot be determined', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation((node, index, name) => {
                if (name === 'resource') return 'action';
                if (name === 'operation') return 'getType';
                if (name === 'actionName') return '/gone';
                return '';
            });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getActionType.mockResolvedValue('');
            mockRosBridgeService.close.mockImplementation(() => { });
            mockNodeErrorHandler.handle.mockImplementation((context, error: unknown) => {
                throw error;
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow();
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });
    });
});
