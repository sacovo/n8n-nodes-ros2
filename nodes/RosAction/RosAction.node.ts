import type {
    IExecuteFunctions,
    ILoadOptionsFunctions,
    INodeExecutionData,
    INodeListSearchResult,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import type { Ros } from 'roslib';

import { RosApiService } from '../shared/services/RosApiService';
import { RosBridgeService, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { RosN8nFormatter } from '../shared/utils/RosN8nFormatter';
import { rosActionProperties } from './RosActionDescription';
import { runOperation, type RosActionOperation } from './RosActionOperations';

export class RosAction implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Action',
        name: 'rosAction',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Send goals to a ROS2 action server and track their progress',
        subtitle: '={{$parameter["operation"] + ": " + $parameter["serverName"]["value"]}}',
        defaults: {
            name: 'ROS2 Action',
        },
        usableAsTool: {
            replacements: {
                description:
                    'Drive a ROS2 action server: send a goal and wait for its result ("sendGoalAndWait", the usual choice for robot tasks like navigation or manipulation), or send one without waiting ("sendGoal") and later cancel it ("cancelGoal") or collect its result ("getResult") using the goalHandle returned. "watchFeedback" and "watchStatus" report progress of goals running on the server. The goal payload must match the action type\'s goal structure - discover it via the ROS2 API tool\'s "getDefinition" operation. Note that a goal sent without waiting can only be cancelled or resolved from the same n8n process that sent it.',
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
        properties: rosActionProperties,
    };

    methods = {
        credentialTest: {
            rosBridgeApi: rosBridgeApiTest,
        },
        listSearch: {
            async getActionsList(
                this: ILoadOptionsFunctions,
                filter?: string,
            ): Promise<INodeListSearchResult> {
                try {
                    const credentials = (await this.getCredentials(
                        'rosBridgeApi',
                    )) as unknown as RosBridgeCredentials;
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

            async getDetectedActionType(
                this: ILoadOptionsFunctions,
                filter?: string,
            ): Promise<INodeListSearchResult> {
                try {
                    const serverNameLocator = this.getNodeParameter('serverName', 0, {
                        extractValue: true,
                    }) as { value: string } | string;
                    const serverName =
                        typeof serverNameLocator === 'string'
                            ? serverNameLocator
                            : serverNameLocator?.value;

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
                                results: [{ name: `Detected: ${type}`, value: type }],
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
        },
        resourceMapping: {
            async getGoalFieldsForType(this: ILoadOptionsFunctions) {
                try {
                    const credentials = (await this.getCredentials(
                        'rosBridgeApi',
                    )) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const actionTypeLocator = this.getNodeParameter('actionType', 0, {
                            extractValue: true,
                        }) as { value: string } | string;
                        let actionType =
                            typeof actionTypeLocator === 'string'
                                ? actionTypeLocator
                                : actionTypeLocator?.value;

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
            let ros: Ros | undefined;
            try {
                const credentials = (await this.getCredentials(
                    'rosBridgeApi',
                )) as unknown as RosBridgeCredentials;
                const operation = this.getNodeParameter('operation', i) as RosActionOperation;

                ros = await RosBridgeService.connect(credentials);
                const json = await runOperation(operation, ros, this, i);

                returnData.push({ json, pairedItem: { item: i } });
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
                RosBridgeService.close(ros);
            }
        }

        return [returnData];
    }
}
