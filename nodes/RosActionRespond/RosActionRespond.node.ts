import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosActionServerService } from '../shared/services/RosActionServerService';
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { assertWriteAllowed } from '../shared/utils/ReadOnlyGuard';

type RespondOperation = 'sendFeedback' | 'setSucceeded' | 'setCanceled' | 'setFailed';

export class RosActionRespond implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Action Respond',
        name: 'rosActionRespond',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description:
            'Send feedback or the final result for a goal received by a ROS2 Action Trigger in this n8n instance',
        subtitle: '={{$parameter["operation"]}}',
        defaults: {
            name: 'ROS2 Action Respond',
        },
        usableAsTool: {
            replacements: {
                description:
                    'Report progress on, or complete, a ROS2 action goal that this same n8n instance received via a ROS2 Action Trigger node. Only useful inside workflows started by that trigger - it operates on the goalId from the triggering event, not on goals sent elsewhere. Not usable for goals sent with the ROS2 Action tool.',
            },
        },
        inputs: [NodeConnectionTypes.Main],
        outputs: [NodeConnectionTypes.Main],
        // The node answers a client through a server registered by the ROS2
        // Action Trigger, so it never opens a connection itself. It still
        // requires the credential: sending feedback or a final result is a
        // write, and the credential is what decides whether writes are allowed.
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
                description: 'The goalId from the ROS2 Action Trigger',
            },
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                options: [
                    {
                        name: 'Send Feedback',
                        value: 'sendFeedback',
                        description: 'Send a progress update to the action client',
                        action: 'Send a progress update to the action client',
                    },
                    {
                        name: 'Set Succeeded',
                        value: 'setSucceeded',
                        description: 'Complete the goal successfully and send the final result',
                        action: 'Complete the goal successfully',
                    },
                    {
                        name: 'Set Canceled',
                        value: 'setCanceled',
                        description: 'Acknowledge a cancel request and end the goal as canceled',
                        action: 'End the goal as canceled',
                    },
                    {
                        name: 'Set Failed',
                        value: 'setFailed',
                        description: 'Abort the goal without a result',
                        action: 'Abort the goal',
                    },
                ],
                default: 'sendFeedback',
            },
            {
                displayName: 'Payload JSON',
                name: 'payloadJson',
                type: 'string',
                typeOptions: {
                    rows: 6,
                },
                default: '{}',
                displayOptions: {
                    hide: {
                        operation: ['setFailed'],
                    },
                },
                description:
                    'JSON object sent as the feedback or result payload. The structure must match the feedback/result part of the action type — use the ROS2 API node\'s "Get Definition" operation to discover the expected fields.',
            },
        ],
    };

    methods = {
        credentialTest: {
            rosBridgeApi: rosBridgeApiTest,
        },
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            try {
                const credentials = await this.getCredentials('rosBridgeApi');
                const goalId = ParameterExtractor.extractRequiredString(this, i, 'goalId');
                const operation = this.getNodeParameter('operation', i) as RespondOperation;

                assertWriteAllowed(this, credentials, `Operation "${operation}" on goal "${goalId}"`, i);

                let payload: Record<string, unknown> = {};
                if (operation !== 'setFailed') {
                    payload = ParameterExtractor.parseJsonParameter(
                        this.getNodeParameter('payloadJson', i) as string,
                        'payloadJson',
                    );
                }

                switch (operation) {
                    case 'sendFeedback':
                        RosActionServerService.sendFeedback(goalId, payload);
                        break;
                    case 'setSucceeded':
                        RosActionServerService.setSucceeded(goalId, payload);
                        break;
                    case 'setCanceled':
                        RosActionServerService.setCanceled(goalId, payload);
                        break;
                    case 'setFailed':
                        RosActionServerService.setFailed(goalId);
                        break;
                }

                returnData.push({
                    json: {
                        goalId,
                        operation,
                        ...(operation === 'setFailed' ? {} : { payload }),
                        timestamp: new Date().toISOString(),
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
            }
        }

        return [returnData];
    }
}
