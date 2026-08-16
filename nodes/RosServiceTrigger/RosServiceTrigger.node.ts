import type {
    IExecuteFunctions,
    INodeType,
    INodeTypeDescription,
    ITriggerFunctions,
    ITriggerResponse,
    ILoadOptionsFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosBridgeService, type JsonRecord, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { RosApiService } from '../shared/services/RosApiService';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { connectWithReconnect } from '../shared/utils/TriggerReconnect';
import { RosN8nFormatter } from '../shared/utils/RosN8nFormatter';
import { assertWriteAllowed } from '../shared/utils/ReadOnlyGuard';

// Trigger nodes cannot be invoked as AI tools, so usableAsTool is omitted
// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool
export class RosServiceTrigger implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Service Trigger',
        name: 'rosServiceTrigger',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['trigger'],
        version: [1],
        description: 'Advertise a ROS2 service and start workflow when called',
        subtitle: '={{$parameter["serviceName"]}}',
        defaults: {
            name: 'ROS2 Service Trigger',
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
                displayName: 'Service Name',
                name: 'serviceName',
                type: 'string',
                default: '',
                required: true,
                placeholder: 'e.g., /my_service',
                description: 'The name of the service to advertise',
            },
            {
                displayName: 'Service Type',
                name: 'serviceType',
                type: 'string',
                default: '',
                required: true,
                placeholder: 'e.g., std_srvs/srv/SetBool',
                description: 'The ROS 2 service type',
            },
            {
                displayName: 'Response Input Mode',
                name: 'responseInputMode',
                type: 'options',
                options: [
                    {
                        name: 'Raw (JSON)',
                        value: 'raw',
                        description: 'Provide raw JSON object for the response',
                    },
                    {
                        name: 'Fixed (Mapper)',
                        value: 'fixed',
                        description: 'Use the visual mapper to define response fields',
                    },
                ],
                default: 'raw',
            },
            {
                displayName: 'Response Structure',
                name: 'responseStructure',
                type: 'resourceMapper',
                default: {
                    mappingMode: 'defineBelow',
                    value: null,
                },
                noDataExpression: true,
                required: true,
                displayOptions: {
                    show: {
                        responseInputMode: ['fixed'],
                    },
                },
                typeOptions: {
                    loadOptionsDependsOn: ['serviceType'],
                    resourceMapper: {
                        resourceMapperMethod: 'getResponseFieldsForType',
                        hideNoDataError: true,
                        addAllFields: false,
                        supportAutoMap: false,
                        mode: 'add',
                        fieldWords: {
                            singular: 'field',
                            plural: 'fields',
                        },
                    },
                },
            },
            {
                displayName: 'Response JSON',
                name: 'responseJson',
                type: 'string',
                typeOptions: {
                    rows: 6,
                },
                displayOptions: {
                    show: {
                        responseInputMode: ['raw'],
                    },
                },
                default: '{}',
                description: 'JSON object sent as immediate service response',
            },
        ],
    };

    methods = {
        credentialTest: {
            rosBridgeApi: rosBridgeApiTest,
        },
        resourceMapping: {
            async getResponseFieldsForType(this: ILoadOptionsFunctions) {
                try {
                    const credentials = (await this.getCredentials(
                        'rosBridgeApi',
                    )) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const serviceType = this.getNodeParameter('serviceType', 0) as string;

                        if (!serviceType) {
                            return { fields: [] };
                        }

                        const typeDefs = await RosApiService.getServiceResponseDetails(ros, serviceType);
                        return RosN8nFormatter.getRosMessageStructure(typeDefs);
                    } finally {
                        RosBridgeService.close(ros);
                    }
                } catch {
                    return { fields: [] };
                }
            },
        },
    };

    async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
        try {
            const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;

            const serviceName = this.getNodeParameter('serviceName') as string;
            const serviceType = this.getNodeParameter('serviceType') as string;

            // Advertising a service adds an endpoint to the ROS graph and
            // answers callers, so it counts as a write.
            assertWriteAllowed(this, credentials, `Advertising service "${serviceName}"`);

            const responseInputMode = this.getNodeParameter('responseInputMode') as 'fixed' | 'raw';

            let responsePayload: JsonRecord = {};
            if (responseInputMode === 'fixed') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const responseStructure = this.getNodeParameter('responseStructure') as any;
                if (responseStructure) {
                    const { value, ...actualFields } = responseStructure;
                    responsePayload = value || actualFields || {};
                }
            } else {
                const responseJson = this.getNodeParameter('responseJson') as string;
                responsePayload = ParameterExtractor.parseJsonParameter(responseJson, 'responseJson');
            }

            const onServiceCall = (request: JsonRecord, response: JsonRecord) => {
                // Immediate response
                Object.assign(response, responsePayload);

                // Trigger workflow
                this.emit([
                    [
                        {
                            json: {
                                request,
                                serviceName,
                                serviceType,
                                respondedWith: responsePayload,
                                timestamp: new Date().toISOString(),
                            },
                        },
                    ],
                ]);

                return true;
            };

            const stop = await connectWithReconnect(credentials, async (ros) => {
                const unsubscribe = await RosBridgeService.advertiseService(
                    ros,
                    serviceName,
                    serviceType,
                    onServiceCall,
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
