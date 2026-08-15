import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosBridgeService } from '../shared/services/RosBridgeService';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { assertWriteAllowed } from '../shared/utils/ReadOnlyGuard';

export class RosActionSendFeedback implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Action Send Feedback',
        name: 'rosActionSendFeedback',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Send feedback or final result for an active ROS2 action goal. Only works for goals received by a ROS2 Action Trigger running in the same n8n instance.',
        subtitle: '={{$parameter["operation"]}}',
        defaults: {
            name: 'ROS2 Action Send Feedback',
        },
        usableAsTool: {
            replacements: {
                description: 'Send feedback for, or complete, a ROS2 action goal that this same n8n instance received via a ROS2 Action Trigger node. Only useful inside workflows started by that trigger - it operates on the goalId from the triggering event, not on goals started elsewhere. Not usable for goals started with the ROS2 Action Start tool.',
            },
        },
        inputs: [NodeConnectionTypes.Main],
        outputs: [NodeConnectionTypes.Main],
        // The node talks to an action client through a server registered by
        // the ROS2 Action Trigger, so it never opens a connection itself. It
        // still requires the credential: sending feedback or a final result
        // is a write, and the credential is what decides whether writes are
        // allowed at all.
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
                description: 'The Goal ID from the ROS2 Action Trigger',
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
                        description: 'Send progress update to the action client',
                        action: 'Send progress update to the action client',
                    },
                    {
                        name: 'Set Succeeded',
                        value: 'setSucceeded',
                        description: 'Complete the action successfully and send final result',
                        action: 'Complete the action successfully and send final result',
                    },
                    {
                        name: 'Set Aborted',
                        value: 'setAborted',
                        description: 'Abort the action and send final result',
                        action: 'Abort the action and send final result',
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
                description: 'JSON object sent as feedback or result payload. The structure must match the feedback/result part of the action type — use the ROS2 API node\'s "Get Definition" operation to discover the expected fields.',
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
                const goalId = this.getNodeParameter('goalId', i) as string;
                const operation = this.getNodeParameter('operation', i) as 'sendFeedback' | 'setSucceeded' | 'setAborted';

                assertWriteAllowed(this, credentials, `Operation "${operation}" on goal "${goalId}"`, i);
                const payloadJson = this.getNodeParameter('payloadJson', i) as string;
                const payload = ParameterExtractor.parseJsonParameter(payloadJson, 'payloadJson');

                if (operation === 'sendFeedback') {
                    RosBridgeService.sendActionFeedback(goalId, payload);
                } else if (operation === 'setSucceeded') {
                    RosBridgeService.setActionSucceeded(goalId, payload);
                } else if (operation === 'setAborted') {
                    RosBridgeService.setActionAborted(goalId, payload);
                }

                returnData.push({
                    json: {
                        goalId,
                        operation,
                        payload,
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
