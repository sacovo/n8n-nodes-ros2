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
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { RosN8nFormatter } from '../shared/utils/RosN8nFormatter';

export class RosActionStart implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Action Start',
        name: 'rosActionStart',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Start a ROS2 action goal and return immediately',
        subtitle: '={{$parameter["serverName"]["value"]}}',
        defaults: {
            name: 'ROS2 Action Start',
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
            {
                displayName: 'Goal Input Mode',
                name: 'goalInputMode',
                type: 'options',
                options: [
                    {
                        name: 'Raw (JSON)',
                        value: 'raw',
                        description: 'Provide raw JSON object for the goal',
                    },
                    {
                        name: 'Fixed (Mapper)',
                        value: 'fixed',
                        description: 'Use the visual mapper to define goal fields',
                    },
                ],
                default: 'raw',
            },
            {
                displayName: 'Goal Structure',
                name: 'goalStructure',
                type: 'resourceMapper',
                default: {
                    mappingMode: 'defineBelow',
                    value: null,
                },
                noDataExpression: true,
                required: true,
                displayOptions: {
                    show: {
                        goalInputMode: ['fixed'],
                    },
                },
                typeOptions: {
                    loadOptionsDependsOn: ['actionName'],
                    resourceMapper: {
                        resourceMapperMethod: 'getGoalFieldsForType',
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
                displayName: 'Goal JSON',
                name: 'goalJson',
                type: 'string',
                typeOptions: {
                    rows: 6,
                },
                displayOptions: {
                    show: {
                        goalInputMode: ['raw'],
                    },
                },
                default: '{}',
                description: 'JSON object sent as action goal payload. The structure must match the goal part of the action type — use the ROS2 API node\'s "Get Definition" operation to discover the expected fields.',
            },
            {
                displayName: 'Send Timeout (Ms)',
                name: 'sendTimeoutMs',
                type: 'number',
                default: 1000,
                description: 'Wait time for an initial status event before returning',
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
        resourceMapping: {
            async getGoalFieldsForType(this: ILoadOptionsFunctions) {
                try {
                    const credentials = (await this.getCredentials(
                        'rosBridgeApi',
                    )) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const actionNameLocator = this.getNodeParameter('actionName', 0, {
                            extractValue: true,
                        }) as { value: string } | string;
                        let actionType =
                            typeof actionNameLocator === 'string'
                                ? actionNameLocator
                                : actionNameLocator?.value;

                        // Auto-detect type from server if not provided
                        if (!actionType) {
                            const serverNameLocator = this.getNodeParameter('serverName', 0, {
                                extractValue: true,
                            }) as { value: string } | string;
                            const serverName =
                                typeof serverNameLocator === 'string'
                                    ? serverNameLocator
                                    : serverNameLocator?.value;
                            if (serverName) {
                                actionType = await RosApiService.getActionType(ros, serverName);
                            }
                        }

                        if (!actionType) {
                            return { fields: [] };
                        }

                        const typeDefs = await RosApiService.getActionGoalDetails(ros, actionType);
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

                // Extract goal based on input mode
                const goalInputMode = this.getNodeParameter('goalInputMode', i) as 'fixed' | 'raw';
                let goalPayload: JsonRecord = {};

                if (goalInputMode === 'fixed') {
                    // Extract goal from resource mapper and remove n8n internal fields
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const goalStructure = this.getNodeParameter('goalStructure', i) as any;
                    if (goalStructure) {
                        const { value, ...actualFields } = goalStructure;
                        goalPayload = value || actualFields || {};
                    }
                } else {
                    const goalJson = this.getNodeParameter('goalJson', i) as string;
                    goalPayload = ParameterExtractor.parseJsonParameter(goalJson, 'goalJson');
                }

                const sendTimeoutMs = ParameterExtractor.extractRequiredNumber(this, i, 'sendTimeoutMs');

                ros = await RosBridgeService.connect(credentials);
                const result = await RosBridgeService.startAction(
                    ros,
                    serverName,
                    actionName,
                    goalPayload,
                    sendTimeoutMs,
                );

                returnData.push({
                    json: {
                        serverName,
                        actionName,
                        goalId: result.goalId,
                        initialStatus: result.status || null,
                        startedAt: new Date().toISOString(),
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