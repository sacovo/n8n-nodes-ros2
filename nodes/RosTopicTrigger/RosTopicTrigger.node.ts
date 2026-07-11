import type {
    IDataObject,
    INodeType,
    INodeTypeDescription,
    ITriggerFunctions,
    ITriggerResponse,
    ILoadOptionsFunctions,
    INodeListSearchResult,
    IExecuteFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosBridgeService, type JsonRecord, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { RosApiService } from '../shared/services/RosApiService';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { RosN8nFormatter } from '../shared/utils/RosN8nFormatter';
import { connectWithReconnect } from '../shared/utils/TriggerReconnect';
import { checkFilter, type FilterData } from '../shared/utils/MessageFilter';

// Trigger nodes cannot be invoked as AI tools, so usableAsTool is omitted
// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
export class RosTopicTrigger implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Topic Trigger',
        name: 'rosTopicTrigger',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['trigger'],
        version: [1],
        description: 'Start workflow when a message is received on a ROS2 topic',
        subtitle: '={{$parameter["topicName"]["value"]}}',
        defaults: {
            name: 'ROS2 Topic Trigger',
        },
        inputs: [],
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
                displayName: 'Include Metadata',
                name: 'includeMetadata',
                type: 'boolean',
                default: true,
                description: 'Whether to include topic metadata in output JSON',
            },
            {
                displayName: 'Conditions',
                name: 'conditions',
                placeholder: 'Add Condition',
                type: 'filter',
                default: {},
                description: 'Only start the workflow for messages matching these conditions. Reference message fields by their path as a plain string, e.g. "data" or "pose.position.x".',
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
    };

    async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
        try {
            const credentials = await this.getCredentials('rosBridgeApi');

            // Extract parameters (resource locators need extractValue to yield the string)
            const topicName = this.getNodeParameter('topicName', '', { extractValue: true }) as string;
            const messageType = this.getNodeParameter('messageType', '', { extractValue: true }) as string;
            const includeMetadata = this.getNodeParameter('includeMetadata', true) as boolean;
            const conditions = this.getNodeParameter('conditions', {}) as FilterData;

            const onMessage = (message: JsonRecord) => {
                if (!checkFilter({ json: { message } }, conditions)) {
                    return;
                }
                const json = includeMetadata
                    ? RosN8nFormatter.formatTopicMessage(topicName, messageType, message)
                    : (message as IDataObject);
                this.emit([[{ json }]]);
            };

            const stop = await connectWithReconnect(
                credentials as unknown as RosBridgeCredentials,
                async (ros) => {
                    const unsubscribe = await RosBridgeService.subscribeToTopic(ros, topicName, messageType, onMessage);
                    return () => {
                        unsubscribe();
                        RosBridgeService.close(ros);
                    };
                },
            );

            return {
                closeFunction: stop,
            };
        } catch (error) {
            NodeErrorHandler.handle(this as unknown as IExecuteFunctions, error as Error, 0);
            throw error;
        }
    }
}
