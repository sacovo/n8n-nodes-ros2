import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosBridgeService, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';

export class RosActionStatus implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Action Status',
        name: 'rosActionStatus',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Check status of a previously started ROS2 action goal',
        defaults: {
            name: 'ROS2 Action Status',
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
                displayName: 'Goal ID',
                name: 'goalId',
                type: 'string',
                default: '={{$json.goalId}}',
                required: true,
                description: 'Goal ID from ROS2 Action Start node output',
            },
            {
                displayName: 'Status Topic',
                name: 'statusTopicName',
                type: 'string',
                default: '/fibonacci/status',
                required: true,
            },
            {
                displayName: 'Status Message Type',
                name: 'statusMessageType',
                type: 'string',
                default: 'action_msgs/GoalStatusArray',
                required: true,
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

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            let ros;
            try {
                const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;
                const goalId = ParameterExtractor.extractRequiredString(this, i, 'goalId');
                const statusTopicName = ParameterExtractor.extractRequiredString(this, i, 'statusTopicName');
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
