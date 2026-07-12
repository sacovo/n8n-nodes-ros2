import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    ILoadOptionsFunctions,
    INodeListSearchResult,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosBridgeService, type JsonRecord, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { RosApiService } from '../shared/services/RosApiService';
import { RosN8nFormatter } from '../shared/utils/RosN8nFormatter';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';

export class RosTopicPublish implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Topic Publish',
        name: 'rosTopicPublish',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Publish a message to a ROS2 topic via rosbridge',
        subtitle: '={{$parameter["topicName"]["value"]}}',
        defaults: {
            name: 'ROS2 Topic Publish',
        },
        usableAsTool: {
            replacements: {
                description: 'Publish a message to a ROS2 topic (operation "publish"; "advertise" only registers the topic without sending anything). The message payload must exactly match the topic\'s message type - use the ROS2 API tool\'s "getDefinition" operation first to discover the required field structure. Fire-and-forget: it does not wait for subscribers to process the message.',
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
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                options: [
                    {
                        name: 'Publish',
                        value: 'publish',
                        description: 'Publish a message to the ROS2 topic',
                        action: 'Publish a message to a topic',
                    },
                    {
                        name: 'Advertise Only',
                        value: 'advertise',
                        description: 'Only advertise the publisher without sending a message',
                        action: 'Advertise a topic',
                    },
                ],
                default: 'publish',
            },
            {
                displayName: 'Topic Name',
                name: 'topicName',
                type: 'resourceLocator',
                default: { mode: 'list', value: '' },
                required: true,
                description: 'Select from available topics or enter manually',
                modes: [
                    {
                        displayName: 'From List',
                        name: 'list',
                        type: 'list',
                        typeOptions: {
                            searchListMethod: 'getTopicsList',
                            searchable: true,
                        },
                    },
                    {
                        displayName: 'ID (Manual)',
                        name: 'id',
                        type: 'string',
                        placeholder: 'e.g., /cmd_vel, /sensor_data',
                    },
                ],
            },
            {
                displayName: 'Message Type',
                name: 'messageType',
                type: 'resourceLocator',
                default: { mode: 'list', value: '' },
                required: true,
                description: 'The ROS 2 message type (e.g. std_msgs/String). "Detected" mode will automatically fetch the type from the selected topic.',
                typeOptions: {
                    loadOptionsDependsOn: ['topicName'],
                },
                modes: [
                    {
                        displayName: 'Detected',
                        name: 'list',
                        type: 'list',
                        typeOptions: {
                            searchListMethod: 'getDetectedType',
                        },
                    },
                    {
                        displayName: 'Manual',
                        name: 'id',
                        type: 'string',
                        placeholder: 'e.g. std_msgs/String',
                    },
                ],
            },
            {
                displayName: 'Message Input Mode',
                name: 'messageInputMode',
                type: 'options',
                displayOptions: {
                    show: {
                        operation: ['publish'],
                    },
                },
                options: [
                    {
                        name: 'Raw (JSON)',
                        value: 'raw',
                        description: 'Provide raw JSON object for the message',
                    },
                    {
                        name: 'Fixed (Mapper)',
                        value: 'fixed',
                        description: 'Use the visual mapper to define message fields',
                    },
                ],
                default: 'raw',
            },
            {
                displayName: 'Message Structure',
                name: 'messageStructure',
                type: 'resourceMapper',
                default: {
                    mappingMode: 'defineBelow',
                    value: null,
                },
                noDataExpression: true,
                required: true,
                displayOptions: {
                    show: {
                        operation: ['publish'],
                        messageInputMode: ['fixed'],
                    },
                },
                typeOptions: {
                    loadOptionsDependsOn: ['messageType'],
                    resourceMapper: {
                        resourceMapperMethod: 'getMessageFieldsForType',
                        hideNoDataError: true,
                        addAllFields: false,
                        supportAutoMap: false,
                        mode: 'add',
                        fieldWords: {
                            singular: 'field',
                            plural: 'fields',
                        },
                    },
                },
            },
            {
                displayName: 'Message JSON',
                name: 'messageJson',
                type: 'string',
                typeOptions: {
                    rows: 8,
                },
                displayOptions: {
                    show: {
                        operation: ['publish'],
                        messageInputMode: ['raw'],
                    },
                },
                default: '{}',
                description: 'JSON object sent as the topic message payload. The structure must match the message type — use the ROS2 API node\'s "Get Definition" operation to discover the expected fields, e.g. {"linear": {"x": 1.0, "y": 0, "z": 0}, "angular": {"x": 0, "y": 0, "z": 0.5}} for geometry_msgs/Twist.',
            },
            {
                displayName: 'Options',
                name: 'options',
                type: 'collection',
                placeholder: 'Add Option',
                default: {},
                displayOptions: {
                    show: {
                        operation: ['publish'],
                    },
                },
                options: [
                    {
                        displayName: 'Timeout for Waiting (Ms)',
                        name: 'discoveryDelay',
                        type: 'number',
                        default: 750,
                        description: 'Time to wait (in milliseconds) after advertising the topic before publishing, to allow subscribers to discover the publisher',
                    },
                    {
                        displayName: 'Burst Option',
                        name: 'burstOption',
                        type: 'boolean',
                        default: false,
                        description: 'Whether to publish the message multiple times in a burst',
                    },
                    {
                        displayName: 'Burst Number',
                        name: 'burstNumber',
                        type: 'number',
                        default: 2,
                        displayOptions: {
                            show: {
                                burstOption: [true],
                            },
                        },
                        description: 'Number of messages to send in the burst',
                    },
                    {
                        displayName: 'Wait Between Messages (Ms)',
                        name: 'burstWait',
                        type: 'number',
                        default: 100,
                        displayOptions: {
                            show: {
                                burstOption: [true],
                            },
                        },
                        description: 'Time to wait (in milliseconds) between sending messages in the burst',
                    },
                ],
            },
        ],
    };

    methods = {
        credentialTest: {
            rosBridgeApi: rosBridgeApiTest,
        },
        loadOptions: {},
        listSearch: {
            async getDetectedType(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
                try {
                    const topicNameLocator = this.getNodeParameter('topicName', 0, {
                        extractValue: true,
                    }) as { value: string } | string;
                    const topicName =
                        typeof topicNameLocator === 'string' ? topicNameLocator : topicNameLocator?.value;

                    if (!topicName) {
                        return { results: [] };
                    }

                    const credentials = (await this.getCredentials(
                        'rosBridgeApi',
                    )) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const type = await RosApiService.getTopicType(ros, topicName);
                        if (type && (!filter || type.toLowerCase().includes(filter.toLowerCase()))) {
                            return {
                                results: [
                                    {
                                        name: `Detected: ${type}`,
                                        value: type,
                                    },
                                ],
                            };
                        }
                    } finally {
                        RosBridgeService.close(ros);
                    }
                } catch {
                    // Ignore errors
                }
                return { results: [] };
            },

            async getTopicsList(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
                try {
                    const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const topics = await RosApiService.getTopics(ros);
                        return { results: RosN8nFormatter.formatTopicListForN8n(topics.topics || [], filter) };
                    } finally {
                        RosBridgeService.close(ros);
                    }
                } catch {
                    return { results: [] };
                }
            },
        },
        resourceMapping: {
            async getMessageFieldsForType(this: ILoadOptionsFunctions) {
                try {
                    const credentials = (await this.getCredentials(
                        'rosBridgeApi',
                    )) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const messageTypeLocator = this.getNodeParameter('messageType', 0, {
                            extractValue: true,
                        }) as { value: string } | string;
                        let messageType =
                            typeof messageTypeLocator === 'string'
                                ? messageTypeLocator
                                : messageTypeLocator?.value;

                        // Auto-detect type from topic if not provided
                        if (!messageType) {
                            const topicNameLocator = this.getNodeParameter('topicName', 0, {
                                extractValue: true,
                            }) as { value: string } | string;
                            const topicName =
                                typeof topicNameLocator === 'string'
                                    ? topicNameLocator
                                    : topicNameLocator?.value;
                            if (topicName) {
                                messageType = await RosApiService.getTopicType(ros, topicName);
                            }
                        }

                        if (!messageType) {
                            return { fields: [] };
                        }

                        const typeDefs = await RosApiService.getMessageDetails(ros, messageType);
                        return RosN8nFormatter.getRosMessageStructure(typeDefs);
                    } finally {
                        RosBridgeService.close(ros);
                    }
                } catch {
                    return { fields: [] };
                }
            },
        },
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            let ros;
            try {
                const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;

                // Extract topic name from resource locator
                const topicNameLocator = this.getNodeParameter('topicName', i) as { mode: string; value: string } | string;
                const topicName = typeof topicNameLocator === 'string'
                    ? topicNameLocator
                    : topicNameLocator.value;

                // Extract message type from resource locator
                const messageTypeLocator = this.getNodeParameter('messageType', i) as { mode: string; value: string } | string;
                const messageType = typeof messageTypeLocator === 'string'
                    ? messageTypeLocator
                    : messageTypeLocator.value;

                const operation = (this.getNodeParameter('operation', i, 'publish') || 'publish') as 'publish' | 'advertise';

                ros = await RosBridgeService.connect(credentials);

                let message: JsonRecord = {};
                if (operation === 'advertise') {
                    await RosBridgeService.advertiseTopic(ros, topicName, messageType);
                } else {
                    // Extract message based on input mode
                    const messageInputMode = this.getNodeParameter('messageInputMode', i) as 'fixed' | 'raw';

                    if (messageInputMode === 'fixed') {
                        // Extract message from resource mapper and remove n8n internal fields
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const messageStructure = this.getNodeParameter('messageStructure', i) as any;
                        if (messageStructure) {
                            const { value, ...actualFields } = messageStructure;
                            message = value || actualFields || {};
                        }
                    } else {
                        message = ParameterExtractor.extractJsonParameter(this, i, 'messageJson');
                    }

                    const options = (this.getNodeParameter('options', i, {}) || {}) as {
                        discoveryDelay?: number;
                        burstOption?: boolean;
                        burstNumber?: number;
                        burstWait?: number;
                    };

                    let burst: { number: number; wait: number } | undefined;
                    if (options.burstOption) {
                        burst = {
                            number: options.burstNumber ?? 2,
                            wait: options.burstWait ?? 100,
                        };
                    }

                    await RosBridgeService.publishTopic(ros, topicName, messageType, message, options.discoveryDelay, burst);
                }

                returnData.push({
                    json: {
                        topic: topicName,
                        messageType,
                        ...(operation === 'publish'
                            ? {
                                  message,
                                  publishedAt: new Date().toISOString(),
                              }
                            : {
                                  advertisedAt: new Date().toISOString(),
                              }),
                    },
                    pairedItem: { item: i },
                });
            } catch (error) {
                if (NodeErrorHandler.shouldReturnErrorOutput(this)) {
                    returnData.push({
                        json: NodeErrorHandler.buildErrorOutput(error),
                        pairedItem: { item: i },
                    });
                    continue;
                }
                NodeErrorHandler.handle(this, error, i);
            } finally {
                if (ros) {
                    RosBridgeService.close(ros);
                }
            }
        }

        return [returnData];
    }
}
