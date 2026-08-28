import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosBridgeService, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { RosApiService } from '../shared/services/RosApiService';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { detectedTypeSearch, topicListSearch } from '../shared/utils/LoadOptions';
import { RosN8nFormatter } from '../shared/utils/RosN8nFormatter';
import { checkFilter, normalizeFilterConditions, type FilterData } from '../shared/utils/MessageFilter';

export class RosTopicNextMessage implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Topic Next Message',
        name: 'rosTopicNextMessage',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Wait for the next message on a ROS2 topic',
        subtitle: '={{$parameter["topicName"]["value"]}}',
        defaults: {
            name: 'ROS2 Topic Next Message',
        },
        usableAsTool: {
            replacements: {
                description:
                    'Wait (blocking, with a configurable timeout) for the next message published on a ROS2 topic and return its contents. Use this to read the current value of a sensor or state topic (e.g. battery level, robot pose) on demand. Use the ROS2 API tool\'s "getDefinition" operation to know what fields the returned message will contain.',
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
                displayName: 'Topic Name',
                name: 'topicName',
                type: 'resourceLocator',
                default: { mode: 'list', value: '' },
                required: true,
                description: 'Select from available topics or enter manually',
                modes: [
                    {
                        displayName: 'From List',
                        name: 'list',
                        type: 'list',
                        typeOptions: {
                            searchListMethod: 'getTopicsList',
                            searchable: true,
                        },
                    },
                    {
                        displayName: 'ID (Manual)',
                        name: 'id',
                        type: 'string',
                        placeholder: 'e.g., /cmd_vel, /sensor_data',
                    },
                ],
            },
            {
                displayName: 'Message Type',
                name: 'messageType',
                type: 'resourceLocator',
                default: { mode: 'list', value: '' },
                required: true,
                description:
                    'The ROS 2 message type (e.g. std_msgs/String). "Detected" mode will automatically fetch the type from the selected topic.',
                typeOptions: {
                    loadOptionsDependsOn: ['topicName'],
                },
                modes: [
                    {
                        displayName: 'Detected',
                        name: 'list',
                        type: 'list',
                        typeOptions: {
                            searchListMethod: 'getDetectedType',
                        },
                    },
                    {
                        displayName: 'Manual',
                        name: 'id',
                        type: 'string',
                        placeholder: 'e.g. std_msgs/String',
                    },
                ],
            },
            {
                displayName: 'Timeout (Ms)',
                name: 'timeoutMs',
                type: 'number',
                default: 5000,
                description: 'Maximum wait time for the next topic message',
            },
            {
                displayName: 'Conditions',
                name: 'conditions',
                placeholder: 'Add Condition',
                type: 'filter',
                default: {},
                description:
                    'Only accept messages matching these conditions; others are skipped while waiting. Reference message fields by their path as a plain string, e.g. "data" or "pose.position.x".',
                typeOptions: {
                    filter: {
                        version: 1,
                        caseSensitive: '={{!$parameter.options.ignoreCase}}',
                        typeValidation: '={{$parameter.options.looseTypeValidation ? "loose" : "strict"}}',
                    },
                },
            },
            {
                displayName: 'Options',
                name: 'options',
                type: 'collection',
                placeholder: 'Add option',
                default: {},
                options: [
                    {
                        displayName: 'Ignore Case',
                        description: 'Whether to ignore letter case when evaluating conditions',
                        name: 'ignoreCase',
                        type: 'boolean',
                        default: true,
                    },
                    {
                        displayName: 'Less Strict Type Validation',
                        description: 'Whether to try casting value types based on the selected operator',
                        name: 'looseTypeValidation',
                        type: 'boolean',
                        default: true,
                    },
                ],
            },
        ],
    };

    methods = {
        credentialTest: {
            rosBridgeApi: rosBridgeApiTest,
        },
        listSearch: {
            getTopicsList: topicListSearch(),
            getDetectedType: detectedTypeSearch('topicName', (ros, topic) => RosApiService.getTopicType(ros, topic)),
        },
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            let ros;
            try {
                const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;

                // Extract parameters

                const topicNameLocator = this.getNodeParameter('topicName', i, {
                    extractValue: true,
                }) as { value: string } | string;
                const topicName = typeof topicNameLocator === 'string' ? topicNameLocator : topicNameLocator?.value;

                const messageTypeLocator = this.getNodeParameter('messageType', i, {
                    extractValue: true,
                }) as { value: string } | string;
                const messageType =
                    typeof messageTypeLocator === 'string' ? messageTypeLocator : messageTypeLocator?.value;
                const timeoutMs = ParameterExtractor.extractRequiredNumber(this, i, 'timeoutMs');
                // Read the filter raw: left values are field paths into the arriving
                // message (legacy workflows stored them as n8n expressions, which must
                // not be evaluated against the node's input item).
                const conditions = normalizeFilterConditions(
                    this.getNodeParameter('conditions', i, {}, { rawExpressions: true }) as FilterData,
                    (expression) => this.evaluateExpression(expression, i),
                );

                // Connect to ROS
                ros = await RosBridgeService.connect(credentials);

                // Wait for the next message that passes the configured conditions
                const result = await RosBridgeService.waitForTopicMessage(
                    ros,
                    topicName,
                    messageType,
                    timeoutMs,
                    (message) => checkFilter({ json: { message } }, conditions),
                );

                returnData.push({
                    json: RosN8nFormatter.formatTopicMessage(topicName, messageType, result),
                    pairedItem: { item: i },
                });
            } catch (error) {
                if (NodeErrorHandler.shouldReturnErrorOutput(this)) {
                    returnData.push({
                        json: NodeErrorHandler.buildErrorOutput(error as Error),
                        pairedItem: { item: i },
                    });
                } else {
                    NodeErrorHandler.handle(this, error as Error, i);
                }
            }
        }

        return [returnData];
    }
}
