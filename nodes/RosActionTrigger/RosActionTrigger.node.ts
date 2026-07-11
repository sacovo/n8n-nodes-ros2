import type {
    IExecuteFunctions,
    INodeType,
    INodeTypeDescription,
    ITriggerFunctions,
    ITriggerResponse,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosBridgeService, type JsonRecord, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { connectWithReconnect } from '../shared/utils/TriggerReconnect';

// Trigger nodes cannot be invoked as AI tools, so usableAsTool is omitted
// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
export class RosActionTrigger implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Action Trigger',
        name: 'rosActionTrigger',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['trigger'],
        version: [1],
        description: 'Advertise a ROS2 action server and start workflow when a goal is received',
        subtitle: '={{$parameter["serverName"]}}',
        defaults: {
            name: 'ROS2 Action Trigger',
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
                displayName: 'Server Name',
                name: 'serverName',
                type: 'string',
                default: '',
                required: true,
                placeholder: 'e.g., /fibonacci',
                description: 'The name of the action server to advertise',
            },
            {
                displayName: 'Action Type',
                name: 'actionName',
                type: 'string',
                default: '',
                required: true,
                placeholder: 'e.g., action_tutorials_interfaces/action/Fibonacci',
                description: 'The ROS 2 action type',
            },
        ],
    };

    async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
        try {
            const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;

            const serverName = this.getNodeParameter('serverName') as string;
            const actionName = this.getNodeParameter('actionName') as string;

            const onGoal = (goalMessage: JsonRecord, goalId: string) => {
                this.emit([
                    [
                        {
                            json: {
                                goal: goalMessage,
                                goalId,
                                serverName,
                                actionName,
                                timestamp: new Date().toISOString(),
                            },
                        },
                    ],
                ]);
            };

            const stop = await connectWithReconnect(credentials, async (ros) => {
                const unsubscribe = await RosBridgeService.registerActionServer(
                    ros,
                    serverName,
                    actionName,
                    onGoal,
                );
                return async () => {
                    await unsubscribe();
                    RosBridgeService.close(ros);
                };
            });

            return {
                closeFunction: stop,
            };
        } catch (error) {
            NodeErrorHandler.handle(this as unknown as IExecuteFunctions, error as Error, 0);
            throw error;
        }
    }
}
