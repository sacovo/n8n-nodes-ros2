import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { RosBridgeService, type JsonRecord, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { RosApiService } from '../shared/services/RosApiService';
import { detectedTypeSearch, topicListSearch, typeFieldsMapper } from '../shared/utils/LoadOptions';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { ResourceMapperCoercer } from '../shared/utils/ResourceMapperCoercer';
import { MessageTypeValidator } from '../shared/utils/MessageTypeValidator';
import { assertInScope, parseTopicScope } from '../shared/utils/TopicScope';
import { assertWriteAllowed } from '../shared/utils/ReadOnlyGuard';

export class RosTopicPublish implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Topic Publish',
        name: 'rosTopicPublish',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Publish a message to a ROS2 topic via rosbridge',
        subtitle: '={{$parameter["topicName"]["value"]}}',
        defaults: {
            name: 'ROS2 Topic Publish',
        },
        usableAsTool: {
            replacements: {
                description: 'Publish a message to a ROS2 topic (operation "publish"; "advertise" only registers the topic without sending anything). The message payload must exactly match the topic\'s message type - use the ROS2 API tool\'s "getDefinition" operation first to discover the required field structure. Fire-and-forget: it does not wait for subscribers to process the message. Publishing may be restricted to certain topic namespaces; a topic outside them returns an error naming the allowed namespaces.',
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
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                options: [
                    {
                        name: 'Publish',
                        value: 'publish',
                        description: 'Publish a message to the ROS2 topic',
                        action: 'Publish a message to a topic',
                    },
                    {
                        name: 'Advertise Only',
                        value: 'advertise',
                        description: 'Only advertise the publisher without sending a message',
                        action: 'Advertise a topic',
                    },
                ],
                default: 'publish',
            },
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
                description: 'The ROS 2 message type (e.g. std_msgs/String). "Detected" mode will automatically fetch the type from the selected topic.',
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
                displayName: 'Message Input Mode',
                name: 'messageInputMode',
                type: 'options',
                displayOptions: {
                    show: {
                        operation: ['publish'],
                    },
                },
                options: [
                    {
                        name: 'Raw (JSON)',
                        value: 'raw',
                        description: 'Provide raw JSON object for the message',
                    },
                    {
                        name: 'Fixed (Mapper)',
                        value: 'fixed',
                        description: 'Use the visual mapper to define message fields',
                    },
                ],
                default: 'raw',
            },
            {
                displayName: 'Message Structure',
                name: 'messageStructure',
                type: 'resourceMapper',
                default: {
                    mappingMode: 'defineBelow',
                    value: null,
                },
                noDataExpression: true,
                required: true,
                displayOptions: {
                    show: {
                        operation: ['publish'],
                        messageInputMode: ['fixed'],
                    },
                },
                typeOptions: {
                    loadOptionsDependsOn: ['messageType'],
                    resourceMapper: {
                        resourceMapperMethod: 'getMessageFieldsForType',
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
                displayName: 'Message JSON',
                name: 'messageJson',
                type: 'string',
                typeOptions: {
                    rows: 8,
                },
                displayOptions: {
                    show: {
                        operation: ['publish'],
                        messageInputMode: ['raw'],
                    },
                },
                default: '{}',
                hint: 'Prefer a guided form? Switch "Message Input Mode" to "Fixed (Mapper)" to get every field of the selected message type pre-filled and editable.',
                description: 'JSON object sent as the topic message payload. The structure must match the message type — use the ROS2 API node\'s "Get Definition" operation to discover the expected fields, e.g. {"linear": {"x": 1.0, "y": 0, "z": 0}, "angular": {"x": 0, "y": 0, "z": 0.5}} for geometry_msgs/Twist.',
            },
            {
                displayName: 'Options',
                name: 'options',
                type: 'collection',
                placeholder: 'Add Option',
                default: {},
                options: [
                    {
                        displayName: 'Allowed Namespaces',
                        name: 'allowedNamespaces',
                        type: 'string',
                        default: '',
                        placeholder: 'e.g. /mani, /any-safe-system',
                        hint: 'As a tool, the agent only learns of this restriction when a call fails. To state it upfront, set the tool node\'s Description to "Set Manually" and name the namespaces there — n8n sends that text verbatim and does not evaluate expressions in it.',
                        description: 'Restrict this node to topics below the listed namespaces (comma- or newline-separated). Matching is on name segments, so "/mani" covers "/mani/cmd_vel" but not "/manipulator"; a "*" segment matches any single segment (e.g. "/robot/*/cmd_vel"). Publishing or advertising anything else fails with an error. Leave empty to allow every topic. Useful when the node is attached to an AI agent, which picks the topic name but cannot change this restriction.',
                    },
                    {
                        displayName: 'Burst Number',
                        name: 'burstNumber',
                        type: 'number',
                        default: 2,
                        displayOptions: {
                            show: {
                                '/operation': ['publish'],
                                burstOption: [true],
                            },
                        },
                        description: 'Number of messages to send in the burst',
                    },
                    {
                        displayName: 'Burst Option',
                        name: 'burstOption',
                        type: 'boolean',
                        default: false,
                        displayOptions: {
                            show: {
                                '/operation': ['publish'],
                            },
                        },
                        description: 'Whether to publish the message multiple times in a burst',
                    },
                    {
                        displayName: 'Timeout for Waiting (Ms)',
                        name: 'discoveryDelay',
                        type: 'number',
                        default: 750,
                        displayOptions: {
                            show: {
                                '/operation': ['publish'],
                            },
                        },
                        description: 'Time to wait (in milliseconds) after advertising the topic before publishing, to allow subscribers to discover the publisher',
                    },
                    {
                        displayName: 'Wait Between Messages (Ms)',
                        name: 'burstWait',
                        type: 'number',
                        default: 100,
                        displayOptions: {
                            show: {
                                '/operation': ['publish'],
                                burstOption: [true],
                            },
                        },
                        description: 'Time to wait (in milliseconds) between sending messages in the burst',
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
            getTopicsList: topicListSearch({ scopeOptionsParameter: 'options' }),
            getDetectedType: detectedTypeSearch('topicName', (ros, topic) =>
                RosApiService.getTopicType(ros, topic),
            ),
        },
        resourceMapping: {
            getMessageFieldsForType: typeFieldsMapper({
                typeParameter: 'messageType',
                source: {
                    parameter: 'topicName',
                    resolve: (ros, topic) => RosApiService.getTopicType(ros, topic),
                },
                fetchTypeDefs: (ros, type) => RosApiService.getMessageDetails(ros, type),
            }),
        },
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];

        for (let i = 0; i < items.length; i++) {
            try {
                const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;

                // Extract topic name from resource locator
                const topicNameLocator = this.getNodeParameter('topicName', i) as { mode: string; value: string } | string;
                const topicName = typeof topicNameLocator === 'string'
                    ? topicNameLocator
                    : topicNameLocator.value;

                // Extract message type from resource locator
                const messageTypeLocator = this.getNodeParameter('messageType', i) as { mode: string; value: string } | string;
                const messageType = typeof messageTypeLocator === 'string'
                    ? messageTypeLocator
                    : messageTypeLocator.value;

                const operation = (this.getNodeParameter('operation', i, 'publish') || 'publish') as 'publish' | 'advertise';

                const options = (this.getNodeParameter('options', i, {}) || {}) as {
                    allowedNamespaces?: string;
                    discoveryDelay?: number;
                    burstOption?: boolean;
                    burstNumber?: number;
                    burstWait?: number;
                };

                // Checked before connecting: advertising alone already
                // registers a publisher, so both operations are gated.
                assertWriteAllowed(
                    this,
                    credentials,
                    operation === 'advertise'
                        ? `Advertising topic "${topicName}"`
                        : `Publishing to topic "${topicName}"`,
                    i,
                );
                assertInScope(this, topicName, parseTopicScope(options.allowedNamespaces), i);

                const ros = await RosBridgeService.connect(credentials);

                let message: JsonRecord = {};
                if (operation === 'advertise') {
                    await RosBridgeService.advertiseTopic(ros, topicName, messageType);
                } else {
                    // Extract message based on input mode
                    const messageInputMode = this.getNodeParameter('messageInputMode', i) as 'fixed' | 'raw';

                    if (messageInputMode === 'fixed') {
                        // Extract message from the resource mapper, parsing each
                        // field into the type its ROS message expects.
                        const messageStructure = this.getNodeParameter('messageStructure', i);
                        message = ResourceMapperCoercer.coerceMessage(messageStructure, this, i);
                    } else {
                        message = ParameterExtractor.extractJsonParameter(this, i, 'messageJson');
                    }

                    // Validate the assembled payload against the real message
                    // type before sending. Skipped if the type can't be
                    // introspected; mismatches abort the publish.
                    if (messageType) {
                        message = await MessageTypeValidator.validateAgainstType(
                            message,
                            this,
                            i,
                            async () =>
                                RosApiService.expandRootTypeDef(
                                    messageType,
                                    await RosApiService.getMessageDetails(ros, messageType),
                                ),
                        );
                    }

                    let burst: { number: number; wait: number } | undefined;
                    if (options.burstOption) {
                        burst = {
                            number: options.burstNumber ?? 2,
                            wait: options.burstWait ?? 100,
                        };
                    }

                    await RosBridgeService.publishTopic(ros, topicName, messageType, message, options.discoveryDelay, burst);
                }

                returnData.push({
                    json: {
                        topic: topicName,
                        messageType,
                        ...(operation === 'publish'
                            ? {
                                  message,
                                  publishedAt: new Date().toISOString(),
                              }
                            : {
                                  advertisedAt: new Date().toISOString(),
                              }),
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
