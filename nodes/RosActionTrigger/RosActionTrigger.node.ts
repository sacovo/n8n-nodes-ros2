import type {
    IExecuteFunctions,
    INodeType,
    INodeTypeDescription,
    ITriggerFunctions,
    ITriggerResponse,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosActionServerService } from '../shared/services/RosActionServerService';
import { RosBridgeService, type JsonRecord, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
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
        description: 'Advertise a ROS2 action server and start the workflow when a goal is received',
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
                name: 'actionType',
                type: 'string',
                default: '',
                required: true,
                placeholder: 'e.g., action_tutorials_interfaces/action/Fibonacci',
                description: 'The ROS 2 action type',
            },
            {
                displayName: 'Emit Cancel Requests',
                name: 'emitCancelRequests',
                type: 'boolean',
                default: false,
                description:
                    'Whether to also emit an item when a client asks to cancel a goal. The item carries eventType "cancel" and the goalId to stop working on; respond to it with the ROS2 Action Respond node\'s "Set Canceled" operation.',
            },
        ],
    };

    methods = {
        credentialTest: {
            rosBridgeApi: rosBridgeApiTest,
        },
    };

    async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
        try {
            const credentials = (await this.getCredentials(
                'rosBridgeApi',
            )) as unknown as RosBridgeCredentials;

            const serverName = this.getNodeParameter('serverName') as string;
            const actionType = this.getNodeParameter('actionType') as string;
            const emitCancelRequests = this.getNodeParameter('emitCancelRequests') as boolean;

            const onGoal = (goal: JsonRecord, goalId: string) => {
                this.emit([
                    [
                        {
                            json: {
                                eventType: 'goal',
                                goal,
                                goalId,
                                serverName,
                                actionType,
                                timestamp: new Date().toISOString(),
                            },
                        },
                    ],
                ]);
            };

            const onCancel = (goalId: string) => {
                if (!emitCancelRequests) {
                    return;
                }
                this.emit([
                    [
                        {
                            json: {
                                eventType: 'cancel',
                                goalId,
                                serverName,
                                actionType,
                                timestamp: new Date().toISOString(),
                            },
                        },
                    ],
                ]);
            };

            const stop = await connectWithReconnect(credentials, async (ros) => {
                const unadvertise = await RosActionServerService.advertise(
                    ros,
                    serverName,
                    actionType,
                    onGoal,
                    onCancel,
                );
                return async () => {
                    await unadvertise();
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
