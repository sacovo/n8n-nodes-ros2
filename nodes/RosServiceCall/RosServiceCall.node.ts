import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    ILoadOptionsFunctions,
    INodeListSearchResult,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosBridgeService, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { RosApiService } from '../shared/services/RosApiService';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { RosN8nFormatter } from '../shared/utils/RosN8nFormatter';


export class RosServiceCall implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Service Call',
        name: 'rosServiceCall',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Call a ROS2 service and wait for the response',
        defaults: {
            name: 'ROS2 Service Call',
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
                type: 'string',
                default: '',
                required: true,
                placeholder: 'example_interfaces/AddTwoInts',
            },
            {
                displayName: 'Request JSON',
                name: 'requestJson',
                type: 'string',
                typeOptions: {
                    rows: 6,
                },
                default: '{}',
                description: 'JSON object sent as service request payload',
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
        listSearch: {
            async getServicesList(
                this: ILoadOptionsFunctions,
            ): Promise<INodeListSearchResult> {
                try {
                    const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const services = await RosApiService.getServices(ros);
                        return { results: RosN8nFormatter.formatServiceListForN8n(services) };
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

                // Extract service name from resource locator
                const serviceNameLocator = this.getNodeParameter('serviceName', i) as
                    | { mode: string; value: string }
                    | string;
                const serviceName =
                    typeof serviceNameLocator === 'string' ? serviceNameLocator : serviceNameLocator.value;

                const serviceType = ParameterExtractor.extractRequiredString(this, i, 'serviceType');
                const requestJson = this.getNodeParameter('requestJson', i) as string;
                const timeoutMs = ParameterExtractor.extractRequiredNumber(this, i, 'timeoutMs');

                ros = await RosBridgeService.connect(credentials);
                const response = await RosBridgeService.callService(
                    ros,
                    serviceName,
                    serviceType,
                    ParameterExtractor.parseJsonParameter(requestJson, 'requestJson'),
                    timeoutMs,
                );

                returnData.push({
                    json: {
                        serviceName,
                        serviceType,
                        request: ParameterExtractor.parseJsonParameter(requestJson, 'requestJson'),
                        response,
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
