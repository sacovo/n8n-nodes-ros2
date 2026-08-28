import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosBridgeService, type JsonRecord, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import type { Ros } from 'roslib';
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { RosApiService } from '../shared/services/RosApiService';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { detectedTypeSearch, listSearch, typeFieldsMapper } from '../shared/utils/LoadOptions';
import { RosN8nFormatter } from '../shared/utils/RosN8nFormatter';
import { ResourceMapperCoercer } from '../shared/utils/ResourceMapperCoercer';
import { MessageTypeValidator } from '../shared/utils/MessageTypeValidator';
import { assertWriteAllowed } from '../shared/utils/ReadOnlyGuard';

export class RosServiceCall implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Service Call',
        name: 'rosServiceCall',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Call a ROS2 service and wait for the response',
        subtitle: '={{$parameter["serviceName"]["value"]}}',
        defaults: {
            name: 'ROS2 Service Call',
        },
        usableAsTool: {
            replacements: {
                description:
                    'Call a ROS2 service and wait for its response. The request payload must exactly match the service type\'s request structure - use the ROS2 API tool\'s "getDefinition" operation first to discover the required fields. Returns the service response once the server replies.',
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
        properties: [
            {
                displayName: 'Service Name',
                name: 'serviceName',
                type: 'resourceLocator',
                default: { mode: 'list', value: '' },
                required: true,
                description: 'Select from available services or enter manually',
                modes: [
                    {
                        displayName: 'From List',
                        name: 'list',
                        type: 'list',
                        typeOptions: {
                            searchListMethod: 'getServicesList',
                            searchable: true,
                        },
                    },
                    {
                        displayName: 'ID (Manual)',
                        name: 'id',
                        type: 'string',
                        placeholder: 'e.g., /add_two_ints, /get_model',
                    },
                ],
            },
            {
                displayName: 'Service Type',
                name: 'serviceType',
                type: 'resourceLocator',
                default: { mode: 'list', value: '' },
                required: true,
                description:
                    'The ROS 2 service type (e.g. example_interfaces/AddTwoInts). "Detected" mode will automatically fetch the type from the selected service.',
                typeOptions: {
                    loadOptionsDependsOn: ['serviceName'],
                },
                modes: [
                    {
                        displayName: 'Detected',
                        name: 'list',
                        type: 'list',
                        typeOptions: {
                            searchListMethod: 'getDetectedServiceType',
                        },
                    },
                    {
                        displayName: 'Manual',
                        name: 'id',
                        type: 'string',
                        placeholder: 'e.g. example_interfaces/AddTwoInts',
                    },
                ],
            },
            {
                displayName: 'Request Input Mode',
                name: 'requestInputMode',
                type: 'options',
                options: [
                    {
                        name: 'Raw (JSON)',
                        value: 'raw',
                        description: 'Provide raw JSON object for the request',
                    },
                    {
                        name: 'Fixed (Mapper)',
                        value: 'fixed',
                        description: 'Use the visual mapper to define request fields',
                    },
                ],
                default: 'raw',
            },
            {
                displayName: 'Request Structure',
                name: 'requestStructure',
                type: 'resourceMapper',
                default: {
                    mappingMode: 'defineBelow',
                    value: null,
                },
                noDataExpression: true,
                required: true,
                displayOptions: {
                    show: {
                        requestInputMode: ['fixed'],
                    },
                },
                typeOptions: {
                    loadOptionsDependsOn: ['serviceType'],
                    resourceMapper: {
                        resourceMapperMethod: 'getRequestFieldsForType',
                        hideNoDataError: true,
                        addAllFields: true,
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
                displayName: 'Request JSON',
                name: 'requestJson',
                type: 'string',
                typeOptions: {
                    rows: 6,
                },
                displayOptions: {
                    show: {
                        requestInputMode: ['raw'],
                    },
                },
                default: '{}',
                hint: 'Prefer a guided form? Switch "Request Input Mode" to "Fixed (Mapper)" to get every field of the selected service request pre-filled and editable.',
                description:
                    'JSON object sent as service request payload. The structure must match the request part of the service type — use the ROS2 API node\'s "Get Definition" operation to discover the expected fields.',
            },
            {
                displayName: 'Timeout (Ms)',
                name: 'timeoutMs',
                type: 'number',
                default: 10000,
                description: 'Maximum wait time for service response',
            },
        ],
    };

    methods = {
        credentialTest: {
            rosBridgeApi: rosBridgeApiTest,
        },
        listSearch: {
            getServicesList: listSearch(
                (ros) => RosApiService.getServices(ros),
                RosN8nFormatter.formatServiceListForN8n,
            ),
            getDetectedServiceType: detectedTypeSearch('serviceName', (ros, service) =>
                RosApiService.getServiceType(ros, service),
            ),
        },
        resourceMapping: {
            getRequestFieldsForType: typeFieldsMapper({
                typeParameter: 'serviceType',
                source: {
                    parameter: 'serviceName',
                    resolve: (ros, service) => RosApiService.getServiceType(ros, service),
                },
                // The mapper describes the request half of the service type.
                normalizeType: (type) => (type.endsWith('_Request') ? type : `${type}_Request`),
                fetchTypeDefs: (ros, type) => RosApiService.getMessageDetails(ros, type),
            }),
        },
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            let ros: Ros | undefined;
            try {
                const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;

                // Extract service name from resource locator
                const serviceNameLocator = this.getNodeParameter('serviceName', i) as
                    | { mode: string; value: string }
                    | string;
                const serviceName =
                    typeof serviceNameLocator === 'string' ? serviceNameLocator : serviceNameLocator.value;

                // A service call runs code on the robot, so it is refused
                // before the request is even assembled.
                assertWriteAllowed(this, credentials, `Calling service "${serviceName}"`, i);

                // Extract service type from resource locator
                const serviceTypeLocator = this.getNodeParameter('serviceType', i) as
                    | { mode: string; value: string }
                    | string;
                const serviceType =
                    typeof serviceTypeLocator === 'string' ? serviceTypeLocator : serviceTypeLocator.value;

                // Extract request based on input mode
                const requestInputMode = this.getNodeParameter('requestInputMode', i) as 'fixed' | 'raw';
                let request: JsonRecord = {};

                if (requestInputMode === 'fixed') {
                    // Extract request from the resource mapper, parsing each
                    // field into the type its ROS request expects.
                    const requestStructure = this.getNodeParameter('requestStructure', i);
                    request = ResourceMapperCoercer.coerceMessage(requestStructure, this, i);
                } else {
                    const requestJson = this.getNodeParameter('requestJson', i) as string;
                    request = ParameterExtractor.parseJsonParameter(requestJson, 'requestJson', this, i);
                }

                const timeoutMs = ParameterExtractor.extractRequiredNumber(this, i, 'timeoutMs');

                ros = await RosBridgeService.connect(credentials);

                // Validate the assembled request against the real service
                // request type before sending. Skipped if the type can't be
                // introspected; mismatches abort the call.
                if (serviceType) {
                    const rosClient = ros;
                    request = await MessageTypeValidator.validateAgainstType(request, this, i, async () =>
                        RosApiService.expandRootTypeDef(
                            serviceType,
                            await RosApiService.getServiceRequestDetails(rosClient, serviceType),
                        ),
                    );
                }

                const response = await RosBridgeService.callService(ros, serviceName, serviceType, request, timeoutMs);

                returnData.push({
                    json: {
                        serviceName,
                        serviceType,
                        request,
                        response,
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
