import type {
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    ILoadOptionsFunctions,
    INodeListSearchResult,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { RosBridgeService, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { RosApiService } from '../shared/services/RosApiService';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { RosN8nFormatter } from '../shared/utils/RosN8nFormatter';

export class RosTopicCaptureImage implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'ROS2 Topic Capture Image',
        name: 'rosTopicCaptureImage',
        icon: { light: 'file:../shared/ros.svg', dark: 'file:../shared/ros.dark.svg' },
        group: ['transform'],
        version: [1],
        description: 'Capture a compressed image (JPEG/PNG) from a ROS2 topic',
        subtitle: '={{$parameter["topicName"]["value"]}}',
        defaults: {
            name: 'ROS2 Topic Capture Image',
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
                displayName: 'Topic Name',
                name: 'topicName',
                type: 'resourceLocator',
                default: { mode: 'list', value: '' },
                required: true,
                description: 'Select from available image topics or enter manually',
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
                        placeholder: 'e.g., /camera/image_raw/compressed',
                    },
                ],
            },
            {
                displayName: 'Message Type',
                name: 'messageType',
                type: 'resourceLocator',
                default: { mode: 'id', value: 'sensor_msgs/msg/CompressedImage' },
                required: true,
                description: 'The ROS 2 message type (e.g. sensor_msgs/msg/CompressedImage). "Detected" mode will automatically fetch the type from the selected topic.',
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
                        placeholder: 'e.g. sensor_msgs/msg/CompressedImage',
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
                displayName: 'Binary Property',
                name: 'dataPropertyName',
                type: 'string',
                default: 'data',
                required: true,
                description: 'Name of the binary property to store the image file in',
            },
        ],
    };

    methods = {
        loadOptions: {},
        listSearch: {
            async getDetectedType(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
                try {
                    const topicNameLocator = this.getNodeParameter('topicName', 0, {
                        extractValue: true,
                    }) as { value: string } | string;
                    const topicName =
                        typeof topicNameLocator === 'string' ? topicNameLocator : topicNameLocator?.value;

                    if (!topicName) {
                        return { results: [] };
                    }

                    const credentials = (await this.getCredentials(
                        'rosBridgeApi',
                    )) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const type = await RosApiService.getTopicType(ros, topicName);
                        if (type && (!filter || type.toLowerCase().includes(filter.toLowerCase()))) {
                            return {
                                results: [
                                    {
                                        name: `Detected: ${type}`,
                                        value: type,
                                    },
                                ],
                            };
                        }
                    } finally {
                        RosBridgeService.close(ros);
                    }
                } catch {
                    // Ignore errors
                }
                return { results: [] };
            },

            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            async getTopicsList(this: ILoadOptionsFunctions, filter?: string, paginationToken?: string): Promise<INodeListSearchResult> {
                try {
                    const credentials = (await this.getCredentials('rosBridgeApi')) as unknown as RosBridgeCredentials;
                    const ros = await RosBridgeService.connect(credentials);
                    try {
                        const topics = await RosApiService.getTopics(ros);
                        return { results: RosN8nFormatter.formatTopicListForN8n(topics.topics || [], filter) };
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
        const continueOnFail = this.continueOnFail();

        for (let i = 0; i < items.length; i++) {
            let ros;
            try {
                const credentials = await this.getCredentials('rosBridgeApi') as unknown as RosBridgeCredentials;

                const topicNameLocator = this.getNodeParameter('topicName', i, {
                    extractValue: true,
                }) as { value: string } | string;
                const topicName =
                    typeof topicNameLocator === 'string' ? topicNameLocator : topicNameLocator?.value;

                const messageTypeLocator = this.getNodeParameter('messageType', i, {
                    extractValue: true,
                }) as { value: string } | string;
                const messageType =
                    typeof messageTypeLocator === 'string' ? messageTypeLocator : messageTypeLocator?.value;
                const timeoutMs = ParameterExtractor.extractRequiredNumber(this, i, 'timeoutMs');
                const dataPropertyName = this.getNodeParameter('dataPropertyName', i) as string;

                // Connect to ROS
                ros = await RosBridgeService.connect(credentials);

                // Wait for next message
                const result = await RosBridgeService.waitForTopicMessage(
                    ros,
                    topicName,
                    messageType,
                    timeoutMs,
                );

                const dataStr = result.data as string;
                if (!dataStr) {
                    throw new NodeOperationError(this.getNode(), 'Image message data is empty or missing.', { itemIndex: i });
                }

                const rawFormat = (result.format as string || 'jpeg').toLowerCase();
                let mimeType = 'image/jpeg';
                let fileExtension = 'jpg';

                if (rawFormat.includes('png')) {
                    mimeType = 'image/png';
                    fileExtension = 'png';
                } else if (rawFormat.includes('bmp')) {
                    mimeType = 'image/bmp';
                    fileExtension = 'bmp';
                } else if (rawFormat.includes('gif')) {
                    mimeType = 'image/gif';
                    fileExtension = 'gif';
                }
                const fileName = `image_${Date.now()}.${fileExtension}`;

                const buffer = Buffer.from(dataStr, 'base64');
                const binaryData = await this.helpers.prepareBinaryData(
                    buffer,
                    fileName,
                    mimeType,
                );

                returnData.push({
                    json: {
                        topic: topicName,
                        messageType: messageType,
                        format: rawFormat,
                    },
                    binary: {
                        [dataPropertyName]: binaryData,
                    },
                    pairedItem: { item: i },
                });
            } catch (error) {
                if (continueOnFail) {
                    returnData.push({
                        json: NodeErrorHandler.buildErrorOutput(error as Error),
                        pairedItem: { item: i },
                    });
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
