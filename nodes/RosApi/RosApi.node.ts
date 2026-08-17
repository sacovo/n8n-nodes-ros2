import type {
    IExecuteFunctions,
    ILoadOptionsFunctions,
    INodeExecutionData,
    INodeListSearchResult,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosApiService } from '../shared/services/RosApiService';
import { RosBridgeService, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { RosN8nFormatter } from '../shared/utils/RosN8nFormatter';
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { rosApiProperties } from './RosApiDescription';
import { assertWriteAllowed } from '../shared/utils/ReadOnlyGuard';
import { isWriteOperation, runOperation, type RosOperation, type RosResource } from './RosApiOperations';

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
                description: 'Discover the live ROS2 graph: list topics, services, nodes, action servers, and parameters, get their types, and look up node details. Crucially, the "getDefinition" operation returns the fully expanded JSON structure (including nested custom types) of any message, service, or action type. The "getType" operation can additionally return human-written documentation: a description of how the specific topic/service is used, and the raw message definition whose comments document units and allowed values. Always call this tool first to learn the exact payload shape before publishing to a topic, calling a service, or starting an action. Parameters belong to a node and are addressed as "nodeName:parameterName" (e.g. "/talker:max_vel_x"), which is how the parameter "list" operation returns them; an unqualified parameter name is refused.',
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
        listSearch: {
            async getNodesList(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
                try {
                    const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const nodes = await RosApiService.getNodes(ros);
                        return { results: RosN8nFormatter.formatNodeListForN8n(nodes, filter) };
                    } finally {
                        RosBridgeService.close(ros);
                    }
                } catch {
                    return { results: [] };
                }
            },

            /**
             * Lists the parameters of the node picked above. rosapi reports
             * them fully qualified as `<node>:<parameter>`; with a node
             * selected only its own parameters are offered, by their bare
             * name, and the node prefix is added back when the operation runs.
             */
            async getParametersList(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
                try {
                    const nodeLocator = this.getNodeParameter('parameterNodeName', 0, {
                        extractValue: true,
                    }) as { value?: string } | string;
                    const rawNodeName = typeof nodeLocator === 'string' ? nodeLocator : nodeLocator?.value;
                    const nodeName = typeof rawNodeName === 'string' ? rawNodeName.trim() : '';

                    const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const parameters = await RosApiService.getParams(ros);
                        const owned = nodeName
                            ? parameters
                                  .filter((parameter) => parameter.startsWith(`${nodeName}:`))
                                  .map((parameter) => parameter.slice(nodeName.length + 1))
                            : parameters;
                        return { results: RosN8nFormatter.formatParameterListForN8n(owned, filter) };
                    } finally {
                        RosBridgeService.close(ros);
                    }
                } catch {
                    return { results: [] };
                }
            },
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

                if (isWriteOperation(resource, operation)) {
                    assertWriteAllowed(this, credentials, `Operation "${operation}: ${resource}"`, i);
                }

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
