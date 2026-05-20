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
        jest.clearAllMocks();
        node = new RosApi();
    });

    describe('execute', () => {
        it('should get topics successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
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
            mockRosApiService.expandTypeDef.mockReturnValue({ data: 'string' });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toMatchObject({
                operation: 'getDefinition',
                resource: 'topic',
                messageType: 'std_msgs/String',
                definition: { data: 'string' },
            });
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
            mockRosApiService.expandTypeDef.mockReturnValueOnce({}).mockReturnValueOnce({ success: 'bool', message: 'string' });
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
    });
});
