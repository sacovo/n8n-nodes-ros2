import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    ILoadOptionsFunctions,
    INodeListSearchResult,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosBridgeService } from '../shared/services/RosBridgeService';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { RosN8nFormatter } from '../shared/utils/RosN8nFormatter';
import { closeRos, connectRos, formatTopicListForN8n, getRosTopics, getRosTopicType, RosBridgeCredentialsData } from '../shared/RosBridgeClient';

export class RosTopicNextMessage implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Topic Next Message',
        name: 'rosTopicNextMessage',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Wait for the next message on a ROS2 topic',
        defaults: {
            name: 'ROS2 Topic Next Message',
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
                displayName: 'Timeout (Ms)',
                name: 'timeoutMs',
                type: 'number',
                default: 5000,
                description: 'Maximum wait time for the next topic message',
            },
            {
                displayName: 'Conditions',
                name: 'conditions',
                placeholder: 'Add Condition',
                type: 'filter',
                default: {},
                description: 'Filter messages based on their content',
                typeOptions: {
                    filter: {
                        version: 1,
                        caseSensitive: '={{!$parameter.options.ignoreCase}}',
                        typeValidation: '={{$parameter.options.looseTypeValidation ? "loose" : "strict"}}',
                    },
                },
            },
            {
                displayName: 'Options',
                name: 'options',
                type: 'collection',
                placeholder: 'Add option',
                default: {},
                options: [
                    {
                        displayName: 'Ignore Case',
                        description: 'Whether to ignore letter case when evaluating conditions',
                        name: 'ignoreCase',
                        type: 'boolean',
                        default: true,
                    },
                    {
                        displayName: 'Less Strict Type Validation',
                        description: 'Whether to try casting value types based on the selected operator',
                        name: 'looseTypeValidation',
                        type: 'boolean',
                        default: true,
                    },
                ],
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

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            async getTopicsList(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string): Promise<INodeListSearchResult> {
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
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];
        const continueOnFail = this.continueOnFail();

        for (let i = 0; i < items.length; i++) {
            let ros;
            try {
                const credentials = await this.getCredentials('rosBridgeApi') as unknown as RosBridgeCredentialsData;

                // Extract parameters

                const topicNameLocator = this.getNodeParameter('topicName', 0, {
                    extractValue: true,
                }) as { value: string } | string;
                const topicName =
                    typeof topicNameLocator === 'string' ? topicNameLocator : topicNameLocator?.value;

                const messageTypeLocator = this.getNodeParameter('messageType', 0, {
                    extractValue: true,
                }) as { value: string } | string;
                const messageType =
                    typeof messageTypeLocator === 'string' ? messageTypeLocator : messageTypeLocator?.value;
                const timeoutMs = ParameterExtractor.extractRequiredNumber(this, i, 'timeoutMs');

                // Connect to ROS
                ros = await RosBridgeService.connect(credentials);

                // Wait for next message
                const result = await RosBridgeService.waitForTopicMessage(
                    ros,
                    topicName,
                    messageType,
                    timeoutMs,
                );

                returnData.push({
                    json: RosN8nFormatter.formatTopicMessage(topicName, messageType, result, result.raw),
                    pairedItem: { item: i },
                });
            } catch (error) {
                if (continueOnFail) {
                    returnData.push({
                        json: NodeErrorHandler.buildErrorOutput(error as Error),
                        pairedItem: { item: i },
                    });
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
