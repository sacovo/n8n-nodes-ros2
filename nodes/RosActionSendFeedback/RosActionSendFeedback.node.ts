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

export class RosActionSendFeedback implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Action Send Feedback',
        name: 'rosActionSendFeedback',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Send feedback or final result for an active ROS2 action goal',
        defaults: {
            name: 'ROS2 Action Send Feedback',
        },
        usableAsTool: true,
        inputs: [NodeConnectionTypes.Main],
        outputs: [NodeConnectionTypes.Main],
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
                displayName: 'Payload Input Mode',
                name: 'payloadInputMode',
                type: 'options',
                options: [
                    {
                        name: 'Raw (JSON)',
                        value: 'raw',
                        description: 'Provide raw JSON object for the feedback/result',
                    },
                    {
                        name: 'Fixed (Mapper)',
                        value: 'fixed',
                        description: 'Use the visual mapper to define payload fields',
                    },
                ],
                default: 'raw',
            },
            {
                displayName: 'Payload JSON',
                name: 'payloadJson',
                type: 'string',
                typeOptions: {
                    rows: 6,
                },
                displayOptions: {
                    show: {
                        payloadInputMode: ['raw'],
                    },
                },
                default: '{}',
                description: 'JSON object sent as feedback or result payload',
            },
        ],
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            try {
                const goalId = this.getNodeParameter('goalId', i) as string;
                const operation = this.getNodeParameter('operation', i) as 'sendFeedback' | 'setSucceeded' | 'setAborted';
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
                if (this.continueOnFail()) {
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
