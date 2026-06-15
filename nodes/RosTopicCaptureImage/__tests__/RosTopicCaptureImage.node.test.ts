import { RosTopicCaptureImage } from '../RosTopicCaptureImage.node';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import { ParameterExtractor } from '../../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../../shared/utils/NodeErrorHandler';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

// Mock the services
jest.mock('../../shared/services/RosBridgeService');
jest.mock('../../shared/utils/ParameterExtractor');
jest.mock('../../shared/utils/NodeErrorHandler');

const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;
const mockParameterExtractor = ParameterExtractor as jest.Mocked<typeof ParameterExtractor>;
const mockNodeErrorHandler = NodeErrorHandler as jest.Mocked<typeof NodeErrorHandler>;

describe('RosTopicCaptureImage', () => {
    let node: RosTopicCaptureImage;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosTopicCaptureImage();
    });

    describe('execute', () => {
        it('should capture compressed image successfully', async () => {
            const mockPrepareBinaryData = jest.fn().mockResolvedValue({
                data: 'dGVzdA==',
                mimeType: 'image/jpeg',
                fileName: 'image_12345.jpg',
            });

            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'topicName') return '/camera/image/compressed';
                    if (name === 'messageType') return 'sensor_msgs/msg/CompressedImage';
                    if (name === 'dataPropertyName') return 'data';
                    return '';
                }),
                helpers: {
                    prepareBinaryData: mockPrepareBinaryData,
                },
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredNumber.mockReturnValue(5000);

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.waitForTopicMessage.mockResolvedValue({
                format: 'jpeg',
                data: 'dGVzdA==', // 'test' in base64
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json).toEqual({
                topic: '/camera/image/compressed',
                messageType: 'sensor_msgs/msg/CompressedImage',
                format: 'jpeg',
            });
            expect(result[0][0].binary).toHaveProperty('data');
            expect(mockPrepareBinaryData).toHaveBeenCalledWith(
                Buffer.from('dGVzdA==', 'base64'),
                expect.stringMatching(/^image_\d+\.jpg$/),
                'image/jpeg',
            );

            expect(mockRosBridgeService.connect).toHaveBeenCalled();
            expect(mockRosBridgeService.waitForTopicMessage).toHaveBeenCalledWith(
                {},
                '/camera/image/compressed',
                'sensor_msgs/msg/CompressedImage',
                5000,
            );
            expect(mockRosBridgeService.close).toHaveBeenCalled();
        });

        it('should handle different formats like PNG', async () => {
            const mockPrepareBinaryData = jest.fn().mockResolvedValue({
                data: 'dGVzdA==',
                mimeType: 'image/png',
                fileName: 'image_12345.png',
            });

            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'topicName') return '/camera/image/compressed';
                    if (name === 'messageType') return 'sensor_msgs/msg/CompressedImage';
                    if (name === 'dataPropertyName') return 'custom_data';
                    return '';
                }),
                helpers: {
                    prepareBinaryData: mockPrepareBinaryData,
                },
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredNumber.mockReturnValue(5000);

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.waitForTopicMessage.mockResolvedValue({
                format: 'png',
                data: 'dGVzdA==',
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                topic: '/camera/image/compressed',
                messageType: 'sensor_msgs/msg/CompressedImage',
                format: 'png',
            });
            expect(result[0][0].binary).toHaveProperty('custom_data');
            expect(mockPrepareBinaryData).toHaveBeenCalledWith(
                Buffer.from('dGVzdA==', 'base64'),
                expect.stringMatching(/^image_\d+\.png$/),
                'image/png',
            );
        });

        it('should throw error when data is missing from message', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'topicName') return '/camera/image/compressed';
                    if (name === 'messageType') return 'sensor_msgs/msg/CompressedImage';
                    if (name === 'dataPropertyName') return 'data';
                    return '';
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredNumber.mockReturnValue(5000);

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.waitForTopicMessage.mockResolvedValue({
                format: 'jpeg',
                // data is missing
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            mockNodeErrorHandler.handle.mockImplementation(() => {
                throw new Error('Image message data is empty or missing.');
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Image message data is empty or missing.');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });
    });
});
