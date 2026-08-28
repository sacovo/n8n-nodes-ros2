import type { IExecuteFunctions, INodeExecutionData, INodeType, INodeTypeDescription } from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { RosBridgeService, type RosBridgeCredentials } from '../shared/services/RosBridgeService';
import { rosBridgeApiTest } from '../shared/utils/CredentialTests';
import { RosApiService } from '../shared/services/RosApiService';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';
import { detectedTypeSearch, topicListSearch } from '../shared/utils/LoadOptions';
import { ImageResizer } from '../shared/utils/ImageResizer';

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
        usableAsTool: {
            replacements: {
                description:
                    'Capture a single compressed image (JPEG/PNG) from a ROS2 image topic and return it as a binary file. Use this when the agent needs to see what a camera currently sees, e.g. for visual inspection or scene description.',
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
                description:
                    'The ROS 2 message type (e.g. sensor_msgs/msg/CompressedImage). "Detected" mode will automatically fetch the type from the selected topic.',
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
            {
                displayName: 'Resize Image',
                name: 'resize',
                type: 'boolean',
                default: false,
                description:
                    'Whether to downscale the image before output to reduce its size and the token cost when sending it to a vision language model',
            },
            {
                displayName: 'Max Width',
                name: 'maxWidth',
                type: 'number',
                default: 1024,
                typeOptions: { minValue: 0 },
                description:
                    'Maximum output width in pixels. Aspect ratio is preserved and the image is never enlarged. Set to 0 to leave the width unbounded.',
                displayOptions: { show: { resize: [true] } },
            },
            {
                displayName: 'Max Height',
                name: 'maxHeight',
                type: 'number',
                default: 1024,
                typeOptions: { minValue: 0 },
                description:
                    'Maximum output height in pixels. Aspect ratio is preserved and the image is never enlarged. Set to 0 to leave the height unbounded.',
                displayOptions: { show: { resize: [true] } },
            },
            {
                displayName: 'Quality',
                name: 'quality',
                type: 'number',
                default: 80,
                typeOptions: { minValue: 1, maxValue: 100 },
                description: 'Encoder quality (1-100) applied to lossy output formats (JPEG/WebP)',
                displayOptions: { show: { resize: [true] } },
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
                const dataPropertyName = this.getNodeParameter('dataPropertyName', i) as string;

                // Connect to ROS
                ros = await RosBridgeService.connect(credentials);

                // Wait for next message
                const result = await RosBridgeService.waitForTopicMessage(ros, topicName, messageType, timeoutMs);

                const dataStr = result.data as string;
                if (!dataStr) {
                    throw new NodeOperationError(this.getNode(), 'Image message data is empty or missing.', {
                        itemIndex: i,
                    });
                }

                const rawFormat = ((result.format as string) || 'jpeg').toLowerCase();

                let buffer: Buffer = Buffer.from(dataStr, 'base64');
                // Format that drives the mime type / file extension. Starts from
                // the ROS message format and is replaced by the actual output
                // format when the image is re-encoded during resizing.
                let resolvedFormat = rawFormat;
                let dimensions: { width: number; height: number } | undefined;

                const resize = this.getNodeParameter('resize', i, false) as boolean;
                if (resize) {
                    const maxWidth = this.getNodeParameter('maxWidth', i, 0) as number;
                    const maxHeight = this.getNodeParameter('maxHeight', i, 0) as number;
                    const quality = this.getNodeParameter('quality', i, 80) as number;

                    const resized = await ImageResizer.resize(buffer, {
                        maxWidth: maxWidth > 0 ? maxWidth : undefined,
                        maxHeight: maxHeight > 0 ? maxHeight : undefined,
                        quality,
                    });
                    buffer = resized.buffer;
                    resolvedFormat = resized.format;
                    dimensions = { width: resized.width, height: resized.height };
                }

                let mimeType = 'image/jpeg';
                let fileExtension = 'jpg';

                if (resolvedFormat.includes('png')) {
                    mimeType = 'image/png';
                    fileExtension = 'png';
                } else if (resolvedFormat.includes('webp')) {
                    mimeType = 'image/webp';
                    fileExtension = 'webp';
                } else if (resolvedFormat.includes('bmp')) {
                    mimeType = 'image/bmp';
                    fileExtension = 'bmp';
                } else if (resolvedFormat.includes('gif')) {
                    mimeType = 'image/gif';
                    fileExtension = 'gif';
                }
                const fileName = `image_${Date.now()}.${fileExtension}`;

                const binaryData = await this.helpers.prepareBinaryData(buffer, fileName, mimeType);

                returnData.push({
                    json: {
                        topic: topicName,
                        messageType: messageType,
                        format: resolvedFormat,
                        ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}),
                    },
                    binary: {
                        [dataPropertyName]: binaryData,
                    },
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
