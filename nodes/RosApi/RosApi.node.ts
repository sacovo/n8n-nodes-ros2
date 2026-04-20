import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';

import { RosBridgeService, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { RosApiService } from '../shared/services/RosApiService';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { Ros } from 'roslib';

export class RosApi implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 API',
        name: 'rosApi',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Query ROS2 master information via rosapi',
        defaults: {
            name: 'ROS2 API',
        },
        usableAsTool: true,
        inputs: [NodeConnectionTypes.Main],
        outputs: [NodeConnectionTypes.Main],
        credentials: [
            {
                name: 'rosBridgeApi',
                required: true,
                testedBy: 'rosBridgeApi',
            },
        ],
        properties: [
            {
                displayName: 'Resource',
                name: 'resource',
                type: 'options',
                default: 'topic',
                noDataExpression: true,
                options: [
                    { name: 'Action', value: 'action' },
                    { name: 'Node', value: 'node' },
                    { name: 'Parameter', value: 'parameter' },
                    { name: 'Service', value: 'service' },
                    { name: 'Topic', value: 'topic' },
                ],
                required: true,
            },
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                displayOptions: {
                    show: {
                        resource: ['action'],
                    },
                },
                options: [
                    {
                        name: 'List', value: 'list',
                        action: 'List an action',
                    },
                ],
                default: 'list',
                noDataExpression: true,
                required: true,
            },
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                displayOptions: {
                    show: {
                        resource: ['node'],
                    },
                },
                options: [
                    {
                        name: 'Get Details', value: 'getDetails',
                        action: 'Get details a node',
                    },
                    {
                        name: 'List', value: 'list',
                        action: 'List a node',
                    },
                ],
                default: 'list',
                noDataExpression: true,
                required: true,
            },
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                displayOptions: {
                    show: {
                        resource: ['parameter'],
                    },
                },
                options: [
                    {
                        name: 'Get', value: 'get',
                        action: 'Get a parameter',
                    },
                    {
                        name: 'List', value: 'list',
                        action: 'List a parameter',
                    },
                    {
                        name: 'Set', value: 'set',
                        action: 'Set a parameter',
                    },
                ],
                default: 'list',
                noDataExpression: true,
                required: true,
            },
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                displayOptions: {
                    show: {
                        resource: ['service'],
                    },
                },
                options: [
                    {
                        name: 'Get Type', value: 'getType',
                        action: 'Get type a service',
                    },
                    {
                        name: 'List', value: 'list',
                        action: 'List a service',
                    },
                    {
                        name: 'List for Type', value: 'listForType',
                        action: 'List for type a service',
                    },
                ],
                default: 'list',
                noDataExpression: true,
                required: true,
            },
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                displayOptions: {
                    show: {
                        resource: ['topic'],
                    },
                },
                options: [
                    {
                        name: 'Get Details', value: 'getDetails',
                        action: 'Get details a topic',
                    },
                    {
                        name: 'Get Type', value: 'getType',
                        action: 'Get type a topic',
                    },
                    {
                        name: 'List', value: 'list',
                        action: 'List a topic',
                    },
                    {
                        name: 'List for Type', value: 'listForType',
                        action: 'List for type a topic',
                    },
                ],
                default: 'list',
                noDataExpression: true,
                required: true,
            },
            {
                displayName: 'Node Name',
                name: 'nodeName',
                type: 'string',
                default: '',
                required: true,
                placeholder: '/talker',
                displayOptions: {
                    show: {
                        resource: ['node'],
                        operation: ['getDetails'],
                    },
                },
            },
            {
                displayName: 'Topic Name',
                name: 'topicName',
                type: 'string',
                default: '',
                required: true,
                placeholder: '/chatter',
                displayOptions: {
                    show: {
                        resource: ['topic'],
                        operation: ['getType', 'getDetails'],
                    },
                },
            },
            {
                displayName: 'Service Name',
                name: 'serviceName',
                type: 'string',
                default: '',
                required: true,
                placeholder: '/add_two_ints',
                displayOptions: {
                    show: {
                        resource: ['service'],
                        operation: ['getType'],
                    },
                },
            },
            {
                displayName: 'Parameter Name',
                name: 'parameterName',
                type: 'string',
                default: '',
                required: true,
                placeholder: '/max_vel_x',
                displayOptions: {
                    show: {
                        resource: ['parameter'],
                        operation: ['get', 'set'],
                    },
                },
            },
            {
                displayName: 'Parameter Value',
                name: 'parameterValue',
                type: 'string',
                default: '',
                required: true,
                displayOptions: {
                    show: {
                        resource: ['parameter'],
                        operation: ['set'],
                    },
                },
                description: 'The value to set. Can be a string, number, boolean, or JSON array/object.',
            },
            {
                displayName: 'Message Type',
                name: 'messageType',
                type: 'string',
                default: '',
                required: true,
                placeholder: 'std_msgs/String',
                displayOptions: {
                    show: {
                        operation: ['listForType'],
                        resource: ['topic', 'service'],
                    },
                },
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];
        const continueOnFail = this.continueOnFail();

        for (let i = 0; i < items.length; i++) {
            let ros;
            try {
                const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;
                this.continueOnFail();

                // Extract operation parameter
                const resource = ParameterExtractor.extractRequiredString(this, i, 'resource');
                const operation = ParameterExtractor.extractRequiredString(this, i, 'operation');


                // Connect to ROS
                ros = await RosBridgeService.connect(credentials);

                const metadata: Record<string, unknown> = { operation, resource };

                const result = await runOperation(resource, operation, ros, this);

                returnData.push({
                    json: {
                        ...metadata,
                        ...result as Record<string, unknown>,
                        retrievedAt: new Date().toISOString(),
                    },
                    pairedItem: { item: i },
                });
            } catch (error) {
                if (continueOnFail) {
                    returnData.push({
                        json: NodeErrorHandler.buildErrorOutput(error as Error),
                        pairedItem: { item: i },
                    });
                    continue;
                } else {
                    NodeErrorHandler.handle(this, error as Error, i);
                }
            } finally {
                if (ros) {
                    RosBridgeService.close(ros);
                }
            }
        }

        return [returnData];
    }
}

async function runOperation(resource: string, operation: string, ros: Ros, node: IExecuteFunctions) {
    switch ([operation, resource].join(':')) {
        case 'list:topic':
            {
                const topicsResult = await RosApiService.getTopics(ros);
                return {
                    topics: topicsResult.topics,
                    types: topicsResult.types,
                };
            }
        case 'list:service':
            {
                const services = await RosApiService.getServices(ros);
                return {
                    services,
                };
            }
        case 'list:node':
            {
                const nodes = await RosApiService.getNodes(ros);
                return {
                    nodes,
                };
            }
        case 'list:action':
            {
                const actionServers = await RosApiService.getActionServers(ros);
                return {
                    actionServers,
                };
            }
        case 'list:parameter':
            {
                const parameters = await RosApiService.getParams(ros);
                return {
                    parameters,
                };
            }
        case 'getType:topic':
            {
                const topicName = ParameterExtractor.extractRequiredString(node, 0, 'topicName');
                const topicType = await RosApiService.getTopicType(ros, topicName);
                return {
                    topicName,
                    topicType,
                };
            }
        case 'getDetails:node':
            {
                const nodeName = ParameterExtractor.extractRequiredString(node, 0, 'nodeName');
                const nodeDetails = await RosApiService.getNodeDetails(ros, nodeName);
                return {
                    nodeName,
                    ...nodeDetails,
                };
            }
        case 'get:parameter':
            {
                const parameterName = ParameterExtractor.extractRequiredString(node, 0, 'parameterName');
                const parameterValue = await RosApiService.getParam(ros, parameterName);
                return {
                    parameterName,
                    parameterValue,
                };
            }
        case 'set:parameter':
            {
                const parameterName = ParameterExtractor.extractRequiredString(node, 0, 'parameterName');
                const parameterValueRaw = ParameterExtractor.extractRequiredString(node, 0, 'parameterValue');
                let parameterValue: unknown;
                try {
                    parameterValue = JSON.parse(parameterValueRaw);
                } catch {
                    // If parsing fails, treat it as a string
                    parameterValue = parameterValueRaw;
                }
                await RosApiService.setParam(ros, parameterName, parameterValue);
                return {
                    parameterName,
                    parameterValue,
                    status: 'success',
                };
            }
        case 'getType:service':
            {
                const serviceName = ParameterExtractor.extractRequiredString(node, 0, 'serviceName');
                const serviceType = await RosApiService.getServiceType(ros, serviceName);
                return {
                    serviceName,
                    serviceType,
                };
            }
        case 'getDetails:topic':
            {
                const topicName = ParameterExtractor.extractRequiredString(node, 0, 'topicName');
                const topicDetails = await RosApiService.getMessageDetails(ros, topicName);
                return {
                    topicName,
                    ...topicDetails,
                };
            }

        case 'listForType:topic':
            {
                const messageType = ParameterExtractor.extractRequiredString(node, 0, 'messageType');
                const topics = await RosApiService.getTopicsForType(ros, messageType);
                return {
                    messageType,
                    topics,
                };
            }
        case 'listForType:service':
            {
                const messageType = ParameterExtractor.extractRequiredString(node, 0, 'messageType');
                const services = await RosApiService.getServicesForType(ros, messageType);
                return {
                    messageType,
                    services,
                };
            }

        default:
            throw new NodeApiError(node.getNode(), { message: `Unsupported operation: ${operation}:${resource}!` });
    }
}
