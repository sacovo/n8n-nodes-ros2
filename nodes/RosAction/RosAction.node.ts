import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import type { Ros } from 'roslib';

import { RosApiService } from '../shared/services/RosApiService';
import { RosBridgeService, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { detectedTypeSearch, listSearch, typeFieldsMapper } from '../shared/utils/LoadOptions';
import { RosN8nFormatter } from '../shared/utils/RosN8nFormatter';
import { assertWriteAllowed } from '../shared/utils/ReadOnlyGuard';
import { rosActionProperties } from './RosActionDescription';
import { isWriteOperation, runOperation, type RosActionOperation } from './RosActionOperations';

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
            getActionsList: listSearch(
                (ros) => RosApiService.getActionServers(ros),
                RosN8nFormatter.formatActionListForN8n,
            ),
            getDetectedActionType: detectedTypeSearch('serverName', (ros, server) =>
                RosApiService.getActionType(ros, server),
            ),
        },
        resourceMapping: {
            getGoalFieldsForType: typeFieldsMapper({
                typeParameter: 'actionType',
                source: {
                    parameter: 'serverName',
                    resolve: (ros, server) => RosApiService.getActionType(ros, server),
                },
                fetchTypeDefs: (ros, type) => RosApiService.getActionGoalDetails(ros, type),
            }),
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

                if (isWriteOperation(operation)) {
                    assertWriteAllowed(this, credentials, `Operation "${operation}"`, i);
                }

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
            }
        }

        return [returnData];
    }
}
