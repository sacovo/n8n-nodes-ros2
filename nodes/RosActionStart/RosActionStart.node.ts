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

export class RosActionStart implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Action Start',
        name: 'rosActionStart',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Start a ROS2 action goal and return immediately',
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
                type: 'string',
                default: '',
                required: true,
                placeholder: '/fibonacci',
            },
            {
                displayName: 'Action Type',
                name: 'actionName',
                type: 'string',
                default: '',
                required: true,
                placeholder: 'action_tutorials_interfaces/FibonacciAction',
            },
            {
                displayName: 'Goal JSON',
                name: 'goalJson',
                type: 'string',
                typeOptions: {
                    rows: 6,
                },
                default: '{}',
                description: 'JSON object sent as action goal payload',
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

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            let ros;
            try {
                const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;
                const serverName = ParameterExtractor.extractRequiredString(this, i, 'serverName');
                const actionName = ParameterExtractor.extractRequiredString(this, i, 'actionName');
                const goalJson = this.getNodeParameter('goalJson', i) as string;
                const sendTimeoutMs = ParameterExtractor.extractRequiredNumber(this, i, 'sendTimeoutMs');

                ros = await RosBridgeService.connect(credentials);
                const result = await RosBridgeService.startAction(
                    ros,
                    serverName,
                    actionName,
                    ParameterExtractor.parseJsonParameter(goalJson, 'goalJson'),
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