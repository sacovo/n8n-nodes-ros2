import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    ILoadOptionsFunctions,
    INodeListSearchResult,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosBridgeService, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { RosApiService } from '../shared/services/RosApiService';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { RosN8nFormatter } from '../shared/utils/RosN8nFormatter';

export class RosActionStatus implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Action Status',
        name: 'rosActionStatus',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Check status of a previously started ROS2 action goal',
        subtitle: '={{$parameter["serverName"]["value"]}}',
        defaults: {
            name: 'ROS2 Action Status',
        },
        usableAsTool: {
            replacements: {
                description: 'Check the current status (e.g. accepted, executing, succeeded, canceled) of a ROS2 action goal previously started with the ROS2 Action Start tool. Requires the goalId returned by that tool. Returns immediately without waiting, unlike ROS2 Action Result.',
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
                displayName: 'Goal ID',
                name: 'goalId',
                type: 'string',
                default: '={{$json.goalId}}',
                required: true,
                description: 'Goal ID from ROS2 Action Start node output',
            },
            {
                displayName: 'Action Server Name',
                name: 'serverName',
                type: 'resourceLocator',
                default: { mode: 'list', value: '' },
                required: true,
                description: 'Select from available action servers or enter manually',
                modes: [
                    {
                        displayName: 'From List',
                        name: 'list',
                        type: 'list',
                        typeOptions: {
                            searchListMethod: 'getActionsList',
                            searchable: true,
                        },
                    },
                    {
                        displayName: 'ID (Manual)',
                        name: 'id',
                        type: 'string',
                        placeholder: 'e.g., /fibonacci',
                    },
                ],
            },
            {
                displayName: 'Status Topic',
                name: 'statusTopicName',
                type: 'resourceLocator',
                default: { mode: 'list', value: '' },
                required: true,
                description: 'Select from available topics or enter manually. "Detected" mode will automatically find the status topic for the selected server.',
                modes: [
                    {
                        displayName: 'Detected',
                        name: 'detected',
                        type: 'list',
                        typeOptions: {
                            searchListMethod: 'getDetectedStatusTopic',
                        },
                    },
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
                        placeholder: 'e.g., /fibonacci/_action/status',
                    },
                ],
            },
            {
                displayName: 'Status Message Type',
                name: 'statusMessageType',
                type: 'string',
                default: 'action_msgs/msg/GoalStatusArray',
                required: true,
                description: 'The ROS 2 message type for status (usually action_msgs/msg/GoalStatusArray)',
            },
            {
                displayName: 'Timeout (Ms)',
                name: 'timeoutMs',
                type: 'number',
                default: 5000,
                description: 'Maximum wait time for the next status message',
            },
        ],
    };

    methods = {
        credentialTest: {
            rosBridgeApi: rosBridgeApiTest,
        },
        listSearch: {
            async getDetectedStatusTopic(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
                try {
                    const serverNameLocator = this.getNodeParameter('serverName', 0, {
                        extractValue: true,
                    }) as { value: string } | string;
                    const serverName =
                        typeof serverNameLocator === 'string' ? serverNameLocator : serverNameLocator?.value;

                    if (!serverName) {
                        return { results: [] };
                    }

                    const statusTopic = serverName.endsWith('/') 
                        ? `${serverName}_action/status` 
                        : `${serverName}/_action/status`;

                    if (!filter || statusTopic.toLowerCase().includes(filter.toLowerCase())) {
                        return {
                            results: [
                                {
                                    name: `Detected: ${statusTopic}`,
                                    value: statusTopic,
                                },
                            ],
                        };
                    }
                } catch {
                    // Ignore errors
                }
                return { results: [] };
            },

            async getActionsList(
                this: ILoadOptionsFunctions,
                filter?: string
            ): Promise<INodeListSearchResult> {
                try {
                    const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const actions = await RosApiService.getActionServers(ros);
                        return { results: RosN8nFormatter.formatActionListForN8n(actions, filter) };
                    } finally {
                        RosBridgeService.close(ros);
                    }
                } catch {
                    return { results: [] };
                }
            },

            async getTopicsList(
                this: ILoadOptionsFunctions,
                filter?: string
            ): Promise<INodeListSearchResult> {
                try {
                    const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const topicsResponse = await RosApiService.getTopics(ros);
                        return { results: RosN8nFormatter.formatTopicListForN8n(topicsResponse.topics, filter) };
                    } finally {
                        RosBridgeService.close(ros);
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

        for (let i = 0; i < items.length; i++) {
            let ros;
            try {
                const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;
                const goalId = ParameterExtractor.extractRequiredString(this, i, 'goalId');

                // Extract server name from resource locator
                const serverNameLocator = this.getNodeParameter('serverName', i) as
                    | { mode: string; value: string }
                    | string;
                const serverName =
                    typeof serverNameLocator === 'string' ? serverNameLocator : serverNameLocator.value;

                // Extract status topic name from resource locator
                const statusTopicNameLocator = this.getNodeParameter('statusTopicName', i) as
                    | { mode: string; value: string }
                    | string;
                const statusTopicName =
                    typeof statusTopicNameLocator === 'string' ? statusTopicNameLocator : statusTopicNameLocator.value;

                const statusMessageType = ParameterExtractor.extractRequiredString(this, i, 'statusMessageType');
                const timeoutMs = ParameterExtractor.extractRequiredNumber(this, i, 'timeoutMs');

                ros = await RosBridgeService.connect(credentials);
                const status = await RosBridgeService.getActionStatusByTopic(
                    ros,
                    statusTopicName,
                    statusMessageType,
                    goalId,
                    timeoutMs,
                );

                returnData.push({
                    json: {
                        goalId,
                        serverName,
                        status: status.status,
                        statusCode: status.statusCode,
                        text: status.text || null,
                        rawStatusMessage: status.raw,
                        checkedAt: new Date().toISOString(),
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
                RosBridgeService.close(ros);
            }
        }

        return [returnData];
    }
}
