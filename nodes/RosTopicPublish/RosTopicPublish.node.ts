import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    ILoadOptionsFunctions,
    INodeListSearchResult,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import {
    closeRos,
    connectRos,
    formatTopicListForN8n,
    getRosMessageDetails,
    getRosMessageStructure,
    getRosTopics,
    getRosTopicType,
    publishRosTopic,
    type JsonRecord,
    type RosBridgeCredentialsData,
} from '../shared/RosBridgeClient';
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
        defaults: {
            name: 'ROS2 Topic Publish',
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
                options: [
                    {
                        name: 'Fixed (Mapper)',
                        value: 'fixed',
                        description: 'Use the visual mapper to define message fields',
                    },
                    {
                        name: 'Raw (JSON)',
                        value: 'raw',
                        description: 'Provide raw JSON object for the message',
                    },
                ],
                default: 'fixed',
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
                        messageInputMode: ['raw'],
                    },
                },
                default: '{}',
                description: 'JSON object sent as the topic message payload',
            },
        ],
    };

    methods = {
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
                    )) as unknown as RosBridgeCredentialsData;
                    const ros = await connectRos(credentials);
                    try {
                        const type = await getRosTopicType(ros, topicName);
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
                        closeRos(ros);
                    }
                } catch {
                    // Ignore errors
                }
                return { results: [] };
            },

            async getTopicsList(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
                try {
                    const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentialsData;
                    const ros = await connectRos(credentials);
                    try {
                        const topics = await getRosTopics(ros);
                        return { results: formatTopicListForN8n(topics.topics || [], filter) };
                    } finally {
                        closeRos(ros);
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
                    )) as unknown as RosBridgeCredentialsData;
                    const ros = await connectRos(credentials);
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
                                messageType = await getRosTopicType(ros, topicName);
                            }
                        }

                        if (!messageType) {
                            return { fields: [] };
                        }

                        const typeDefs = await getRosMessageDetails(ros, messageType);
                        return getRosMessageStructure(typeDefs);
                    } finally {
                        closeRos(ros);
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
                const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentialsData;

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

                // Extract message based on input mode
                const messageInputMode = this.getNodeParameter('messageInputMode', i) as 'fixed' | 'raw';
                let message: JsonRecord = {};

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

                ros = await connectRos(credentials);
                await publishRosTopic(ros, topicName, messageType, message);

                returnData.push({
                    json: {
                        topic: topicName,
                        messageType,
                        message,
                        publishedAt: new Date().toISOString(),
                    },
                    pairedItem: { item: i },
                });
            } catch (error) {
                if (this.continueOnFail()) {
                    returnData.push({
                        json: NodeErrorHandler.buildErrorOutput(error),
                        pairedItem: { item: i },
                    });
                    continue;
                }
                NodeErrorHandler.handle(this, error, i);
            } finally {
                if (ros) {
                    closeRos(ros);
                }
            }
        }

        return [returnData];
    }
}
