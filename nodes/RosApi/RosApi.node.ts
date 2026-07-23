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
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { rosApiProperties } from './RosApiDescription';
import { runOperation, type RosOperation, type RosResource } from './RosApiOperations';

export class RosApi implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 API',
        name: 'rosApi',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Query ROS2 master information via rosapi',
        subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
        defaults: {
            name: 'ROS2 API',
        },
        usableAsTool: {
            replacements: {
                description: 'Discover the live ROS2 graph: list topics, services, nodes, action servers, and parameters, get their types, and look up node details. Crucially, the "getDefinition" operation returns the fully expanded JSON structure (including nested custom types) of any message, service, or action type. The "getType" operation can additionally return human-written documentation: a description of how the specific topic/service is used, and the raw message definition whose comments document units and allowed values. Always call this tool first to learn the exact payload shape before publishing to a topic, calling a service, or starting an action.',
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
        properties: rosApiProperties,
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
            let ros;
            try {
                const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;

                // Extract operation parameter
                const resource = ParameterExtractor.extractRequiredString(this, i, 'resource') as RosResource;
                const operation = ParameterExtractor.extractRequiredString(this, i, 'operation') as RosOperation;


                // Connect to ROS
                ros = await RosBridgeService.connect(credentials);

                const metadata: Record<string, unknown> = { operation, resource };

                const result = await runOperation(resource, operation, ros, this, i);

                returnData.push({
                    json: {
                        ...metadata,
                        ...result as Record<string, unknown>,
                        retrievedAt: new Date().toISOString(),
                    },
                    pairedItem: { item: i },
                });
            } catch (error) {
                if (NodeErrorHandler.shouldReturnErrorOutput(this)) {
                    returnData.push({
                        json: NodeErrorHandler.buildErrorOutput(error as Error),
                        pairedItem: { item: i },
                    });
                    continue;
                } else {
                    NodeErrorHandler.handle(this, error as Error, i);
                }
            } finally {
                if (ros) {
                    RosBridgeService.close(ros);
                }
            }
        }

        return [returnData];
    }
}
