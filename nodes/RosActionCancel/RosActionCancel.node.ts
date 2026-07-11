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

export class RosActionCancel implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Action Cancel',
        name: 'rosActionCancel',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Cancel an active ROS2 action goal',
        subtitle: '={{$parameter["serverName"]["value"]}}',
        defaults: {
            name: 'ROS2 Action Cancel',
        },
        usableAsTool: {
            replacements: {
                description: 'Cancel an active ROS2 action goal previously started with the ROS2 Action Start tool. Requires the goalId returned by that tool. Use this to stop a long-running action (e.g. navigation, manipulation) before it completes on its own.',
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
                displayName: 'Action Type',
                name: 'actionName',
                type: 'resourceLocator',
                default: { mode: 'list', value: '' },
                required: true,
                description: 'The ROS 2 action type (e.g. action_tutorials_interfaces/Fibonacci). "Detected" mode will automatically fetch the type from the selected server.',
                typeOptions: {
                    loadOptionsDependsOn: ['serverName'],
                },
                modes: [
                    {
                        displayName: 'Detected',
                        name: 'list',
                        type: 'list',
                        typeOptions: {
                            searchListMethod: 'getDetectedActionType',
                        },
                    },
                    {
                        displayName: 'Manual',
                        name: 'id',
                        type: 'string',
                        placeholder: 'e.g., action_tutorials_interfaces/Fibonacci',
                    },
                ],
            },
        ],
    };

    methods = {
        credentialTest: {
            rosBridgeApi: rosBridgeApiTest,
        },
        listSearch: {
            async getDetectedActionType(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
                try {
                    const serverNameLocator = this.getNodeParameter('serverName', 0, {
                        extractValue: true,
                    }) as { value: string } | string;
                    const serverName =
                        typeof serverNameLocator === 'string' ? serverNameLocator : serverNameLocator?.value;

                    if (!serverName) {
                        return { results: [] };
                    }

                    const credentials = (await this.getCredentials(
                        'rosBridgeApi',
                    )) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const type = await RosApiService.getActionType(ros, serverName);
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

                // Extract action type from resource locator
                const actionNameLocator = this.getNodeParameter('actionName', i) as { mode: string; value: string } | string;
                const actionName = typeof actionNameLocator === 'string'
                    ? actionNameLocator
                    : actionNameLocator.value;

                ros = await RosBridgeService.connect(credentials);
                const cancelResult = await RosBridgeService.cancelAction(
                    ros,
                    serverName,
                    actionName,
                    goalId,
                );

                returnData.push({
                    json: {
                        goalId,
                        serverName,
                        actionName,
                        cancelResult,
                        canceledAt: new Date().toISOString(),
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
