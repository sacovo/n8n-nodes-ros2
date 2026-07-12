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
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { Ros } from 'roslib';

export class RosApi implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 API',
        name: 'rosApi',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Query ROS2 master information via rosapi',
        subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
        defaults: {
            name: 'ROS2 API',
        },
        usableAsTool: {
            replacements: {
                description: 'Discover the live ROS2 graph: list topics, services, nodes, action servers, and parameters, get their types, and look up node details. Crucially, the "getDefinition" operation returns the fully expanded JSON structure (including nested custom types) of any message, service, or action type. The "getType" operation can additionally return human-written documentation: a description of how the specific topic/service is used, and the raw message definition whose comments document units and allowed values. Always call this tool first to learn the exact payload shape before publishing to a topic, calling a service, or starting an action.',
            },
        },
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
                        name: 'Get Definition', value: 'getDefinition',
                        action: 'Get the expanded definition of an action',
                        description: 'Get the expanded goal, result and feedback structure of an action type',
                    },
                    {
                        name: 'Get Type', value: 'getType',
                        action: 'Get the type of an action',
                        description: 'Get the action type of an action server by its name, optionally with its documentation (description)',
                    },
                    {
                        name: 'List', value: 'list',
                        action: 'List action servers',
                        description: 'List all available action servers',
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
                        name: 'Get Definition', value: 'getDefinition',
                        action: 'Get the expanded definitions of all topics and services of a node',
                        description: 'Get every topic, service and action of a node together with the expanded structure of their message types',
                    },
                    {
                        name: 'Get Details', value: 'getDetails',
                        action: 'Get details of a node',
                        description: 'List the names of the topics and services of a node',
                    },
                    {
                        name: 'List', value: 'list',
                        action: 'List nodes',
                        description: 'List all running nodes',
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
                        description: 'Get the value of a parameter',
                    },
                    {
                        name: 'List', value: 'list',
                        action: 'List parameters',
                        description: 'List all parameter names',
                    },
                    {
                        name: 'Set', value: 'set',
                        action: 'Set a parameter',
                        description: 'Set the value of a parameter',
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
                        name: 'Get Definition', value: 'getDefinition',
                        action: 'Get the expanded definition of a service',
                        description: 'Get the expanded request and response structure of a service, so you know which fields a call expects and returns',
                    },
                    {
                        name: 'Get Type', value: 'getType',
                        action: 'Get the type of a service',
                        description: 'Get the service type of a service by its name, optionally with its documentation (description)',
                    },
                    {
                        name: 'List', value: 'list',
                        action: 'List services',
                        description: 'List all available services',
                    },
                    {
                        name: 'List for Type', value: 'listForType',
                        action: 'List services of a type',
                        description: 'List all services that use a given service type',
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
                        name: 'Get Definition', value: 'getDefinition',
                        action: 'Get the expanded definition of a topic message type',
                        description: 'Get the expanded message structure of a topic, so you know which fields to publish or expect when subscribing',
                    },
                    {
                        name: 'Get Details', value: 'getDetails',
                        action: 'Get details of a topic',
                        description: 'Get the raw type definitions of a topic message type',
                    },
                    {
                        name: 'Get Type', value: 'getType',
                        action: 'Get the type of a topic',
                        description: 'Get the message type of a topic by its name, optionally with its documentation (description and raw message definition including comments)',
                    },
                    {
                        name: 'List', value: 'list',
                        action: 'List topics',
                        description: 'List all available topics and their message types',
                    },
                    {
                        name: 'List for Type', value: 'listForType',
                        action: 'List topics of a type',
                        description: 'List all topics that use a given message type',
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
                        operation: ['getDetails', 'getDefinition'],
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
                        operation: ['getType', 'getDetails', 'getDefinition'],
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
                        operation: ['getType', 'getDefinition'],
                    },
                },
            },
            {
                displayName: 'Action Name',
                name: 'actionName',
                type: 'string',
                default: '',
                placeholder: '/fibonacci',
                displayOptions: {
                    show: {
                        resource: ['action'],
                        operation: ['getDefinition'],
                    },
                },
                description: 'The action server name. Used to infer the action type if Message Type is not provided.',
            },
            {
                displayName: 'Action Name',
                name: 'actionName',
                type: 'string',
                default: '',
                required: true,
                placeholder: '/fibonacci',
                displayOptions: {
                    show: {
                        resource: ['action'],
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
            {
                displayName: 'Message Type',
                name: 'messageType',
                type: 'string',
                default: '',
                placeholder: 'std_msgs/String',
                displayOptions: {
                    show: {
                        operation: ['getDefinition'],
                        resource: ['topic', 'service', 'action'],
                    },
                },
                description: 'The ROS type (e.g., std_msgs/String). If not provided, it will be inferred from the name.',
            },
            {
                displayName: 'Include Description',
                name: 'includeDescription',
                type: 'boolean',
                default: false,
                displayOptions: {
                    show: {
                        resource: ['topic', 'service', 'action'],
                        operation: ['getType'],
                    },
                },
                description: 'Whether to also read the latched &lt;name&gt;/desc documentation topic (std_msgs/String, published by the node owning this interface) and return its text as "description". Null when the interface is undocumented.',
            },
            {
                displayName: 'Include Raw Definition',
                name: 'includeRawDefinition',
                type: 'boolean',
                default: false,
                displayOptions: {
                    show: {
                        resource: ['topic'],
                        operation: ['getType'],
                    },
                },
                description: 'Whether to also return the raw message definition text as written in the .msg source, including comments that document units and allowed values. Only available for message types currently used by an active topic; null otherwise.',
            },
            {
                displayName: 'Grep Pattern',
                name: 'grep',
                type: 'string',
                default: '',
                displayOptions: {
                    show: {
                        operation: ['list', 'listForType'],
                    },
                },
                description: 'Filter list results using a regular expression or plain text (case-insensitive)',
            },
            {
                displayName: 'Combine Topics and Types',
                name: 'combineTopicsAndTypes',
                type: 'boolean',
                default: false,
                displayOptions: {
                    show: {
                        resource: ['topic'],
                        operation: ['list'],
                    },
                },
                description: 'Whether to return a single "topics" array of { name, type } objects instead of the separate "topics" and "types" arrays. Avoids having to match items across two arrays by index.',
            },
        ],
    };

    methods = {
        credentialTest: {
            rosBridgeApi: rosBridgeApiTest,
        },
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            let ros;
            try {
                const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;

                // Extract operation parameter
                const resource = ParameterExtractor.extractRequiredString(this, i, 'resource') as RosResource;
                const operation = ParameterExtractor.extractRequiredString(this, i, 'operation') as RosOperation;


                // Connect to ROS
                ros = await RosBridgeService.connect(credentials);

                const metadata: Record<string, unknown> = { operation, resource };

                const result = await runOperation(resource, operation, ros, this, i);

                returnData.push({
                    json: {
                        ...metadata,
                        ...result as Record<string, unknown>,
                        retrievedAt: new Date().toISOString(),
                    },
                    pairedItem: { item: i },
                });
            } catch (error) {
                if (NodeErrorHandler.shouldReturnErrorOutput(this)) {
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

type RosResource = 'action' | 'node' | 'parameter' | 'service' | 'topic';
type RosOperation = 'list' | 'getDetails' | 'get' | 'set' | 'getType' | 'listForType' | 'getDefinition';

async function runOperation(resource: RosResource, operation: RosOperation, ros: Ros, node: IExecuteFunctions, itemIndex: number) {
    const actionKey: `${RosOperation}:${RosResource}` = `${operation}:${resource}`;
    switch (actionKey) {
        case 'list:topic':
            {
                const topicsResult = await RosApiService.getTopics(ros);
                let topics = topicsResult.topics;
                let types = topicsResult.types;
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    const filteredTopics: string[] = [];
                    const filteredTypes: string[] = [];
                    for (let idx = 0; idx < topics.length; idx++) {
                        const topic = topics[idx];
                        const type = types[idx];
                        if (matchesPattern(topic, grep) || (type && matchesPattern(type, grep))) {
                            filteredTopics.push(topic);
                            if (types.length > idx) {
                                filteredTypes.push(type);
                            }
                        }
                    }
                    topics = filteredTopics;
                    types = filteredTypes;
                }
                const combineTopicsAndTypes = node.getNodeParameter('combineTopicsAndTypes', itemIndex, false) as boolean;
                if (combineTopicsAndTypes) {
                    return {
                        topics: topics.map((topic, idx) => ({ name: topic, type: types[idx] })),
                    };
                }
                return {
                    topics,
                    types,
                };
            }
        case 'list:service':
            {
                let services = await RosApiService.getServices(ros);
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    services = services.filter(service => matchesPattern(service, grep));
                }
                return {
                    services,
                };
            }
        case 'list:node':
            {
                let nodes = await RosApiService.getNodes(ros);
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    nodes = nodes.filter(n => matchesPattern(n, grep));
                }
                return {
                    nodes,
                };
            }
        case 'list:action':
            {
                let actionServers = await RosApiService.getActionServers(ros);
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    actionServers = actionServers.filter(action => matchesPattern(action, grep));
                }
                return {
                    actionServers,
                };
            }
        case 'list:parameter':
            {
                let parameters = await RosApiService.getParams(ros);
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    parameters = parameters.filter(param => matchesPattern(param, grep));
                }
                return {
                    parameters,
                };
            }
        case 'getType:topic':
            {
                const topicName = ParameterExtractor.extractRequiredString(node, itemIndex, 'topicName');
                const topicType = await RosApiService.getTopicType(ros, topicName);
                const result: Record<string, unknown> = {
                    topicName,
                    topicType,
                };
                if (node.getNodeParameter('includeDescription', itemIndex, false) as boolean) {
                    result.description = await RosApiService.getInterfaceDescription(ros, topicName);
                }
                if (node.getNodeParameter('includeRawDefinition', itemIndex, false) as boolean) {
                    result.rawDefinition = await RosApiService.getTopicRawDefinition(ros, topicName, topicType);
                }
                return result;
            }
        case 'getDetails:node':
            {
                const nodeName = ParameterExtractor.extractRequiredString(node, itemIndex, 'nodeName');
                const nodeDetails = await RosApiService.getNodeDetails(ros, nodeName);
                return {
                    nodeName,
                    ...nodeDetails,
                };
            }
        case 'get:parameter':
            {
                const parameterName = ParameterExtractor.extractRequiredString(node, itemIndex, 'parameterName');
                const parameterValue = await RosApiService.getParam(ros, parameterName);
                return {
                    parameterName,
                    parameterValue,
                };
            }
        case 'set:parameter':
            {
                const parameterName = ParameterExtractor.extractRequiredString(node, itemIndex, 'parameterName');
                const parameterValueRaw = ParameterExtractor.extractRequiredString(node, itemIndex, 'parameterValue');
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
                const serviceName = ParameterExtractor.extractRequiredString(node, itemIndex, 'serviceName');
                const serviceType = await RosApiService.getServiceType(ros, serviceName);
                const result: Record<string, unknown> = {
                    serviceName,
                    serviceType,
                };
                if (node.getNodeParameter('includeDescription', itemIndex, false) as boolean) {
                    result.description = await RosApiService.getInterfaceDescription(ros, serviceName);
                }
                return result;
            }
        case 'getType:action':
            {
                const actionName = ParameterExtractor.extractRequiredString(node, itemIndex, 'actionName');
                const actionType = await RosApiService.getActionType(ros, actionName);
                if (!actionType) {
                    throw new NodeApiError(node.getNode(), { message: `Could not determine the action type of ${actionName}. Is the action server running?` });
                }
                const result: Record<string, unknown> = {
                    actionName,
                    actionType,
                };
                if (node.getNodeParameter('includeDescription', itemIndex, false) as boolean) {
                    result.description = await RosApiService.getInterfaceDescription(ros, actionName);
                }
                return result;
            }
        case 'getDefinition:topic':
            {
                let messageType = ParameterExtractor.extractOptionalString(node, itemIndex, 'messageType');
                if (!messageType) {
                    const topicName = ParameterExtractor.extractRequiredString(node, itemIndex, 'topicName');
                    messageType = await RosApiService.getTopicType(ros, topicName);
                }
                const typedefs = await RosApiService.getMessageDetails(ros, messageType as string);
                const definition = RosApiService.expandRootTypeDef(messageType as string, typedefs);
                return {
                    messageType,
                    definition,
                };
            }
        case 'getDefinition:service':
            {
                let serviceType = ParameterExtractor.extractOptionalString(node, itemIndex, 'messageType');
                if (!serviceType) {
                    const serviceName = ParameterExtractor.extractRequiredString(node, itemIndex, 'serviceName');
                    serviceType = await RosApiService.getServiceType(ros, serviceName);
                }
                const [requestDetails, responseDetails] = await Promise.all([
                    RosApiService.getServiceRequestDetails(ros, serviceType as string),
                    RosApiService.getServiceResponseDetails(ros, serviceType as string),
                ]);
                return {
                    serviceType,
                    request: RosApiService.expandRootTypeDef(serviceType as string, requestDetails),
                    response: RosApiService.expandRootTypeDef(serviceType as string, responseDetails),
                };
            }
        case 'getDefinition:action':
            {
                let actionType = ParameterExtractor.extractOptionalString(node, itemIndex, 'messageType');
                if (!actionType) {
                    const actionName = ParameterExtractor.extractOptionalString(node, itemIndex, 'actionName');
                    if (actionName) {
                        actionType = await RosApiService.getActionType(ros, actionName);
                    }
                }
                if (!actionType) {
                    throw new NodeApiError(node.getNode(), { message: 'Provide either Action Name or Message Type for getDefinition:action' });
                }
                const [goalDetails, resultDetails, feedbackDetails] = await Promise.all([
                    RosApiService.getActionGoalDetails(ros, actionType as string),
                    RosApiService.getActionResultDetails(ros, actionType as string),
                    RosApiService.getActionFeedbackDetails(ros, actionType as string),
                ]);

                return {
                    actionType,
                    goal: RosApiService.expandRootTypeDef(actionType as string, goalDetails),
                    result: RosApiService.expandRootTypeDef(actionType as string, resultDetails),
                    feedback: RosApiService.expandRootTypeDef(actionType as string, feedbackDetails),
                };
            }
        case 'getDefinition:node':
            {
                const nodeName = ParameterExtractor.extractRequiredString(node, itemIndex, 'nodeName');
                const nodeDefinition = await RosApiService.getNodeDefinition(ros, nodeName);
                return {
                    nodeName,
                    ...nodeDefinition,
                };
            }
        case 'getDetails:topic':
            {
                const topicName = ParameterExtractor.extractRequiredString(node, itemIndex, 'topicName');
                // message_details expects a type, so resolve the topic's type first
                const topicType = await RosApiService.getTopicType(ros, topicName);
                const typedefs = await RosApiService.getMessageDetails(ros, topicType);
                return {
                    topicName,
                    topicType,
                    typedefs,
                };
            }

        case 'listForType:topic':
            {
                const messageType = ParameterExtractor.extractRequiredString(node, itemIndex, 'messageType');
                let topics = await RosApiService.getTopicsForType(ros, messageType);
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    topics = topics.filter(topic => matchesPattern(topic, grep));
                }
                return {
                    messageType,
                    topics,
                };
            }
        case 'listForType:service':
            {
                const messageType = ParameterExtractor.extractRequiredString(node, itemIndex, 'messageType');
                let services = await RosApiService.getServicesForType(ros, messageType);
                const grep = ParameterExtractor.extractOptionalString(node, itemIndex, 'grep');
                if (grep) {
                    services = services.filter(service => matchesPattern(service, grep));
                }
                return {
                    messageType,
                    services,
                };
            }

        default:
            throw new NodeApiError(node.getNode(), { message: `Unsupported operation: ${operation}:${resource}!` });
    }
}

function matchesPattern(text: string, pattern: string): boolean {
    try {
        const regex = new RegExp(pattern, 'i');
        return regex.test(text);
    } catch {
        return text.toLowerCase().includes(pattern.toLowerCase());
    }
}
