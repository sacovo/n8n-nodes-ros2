/**
 * Unit tests for RosApi node
 */

import { RosApi } from '../RosApi.node';
import { RosApiService } from '../../shared/services/RosApiService';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import { ParameterExtractor } from '../../shared/utils/ParameterExtractor';
import { NodeErrorHandler } from '../../shared/utils/NodeErrorHandler';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

// Mock the services
jest.mock('../../shared/services/RosBridgeService');
jest.mock('../../shared/services/RosApiService');
jest.mock('../../shared/utils/ParameterExtractor');
jest.mock('../../shared/utils/NodeErrorHandler');

const mockRosApiService = RosApiService as jest.Mocked<typeof RosApiService>;
const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;
const mockParameterExtractor = ParameterExtractor as jest.Mocked<typeof ParameterExtractor>;
const mockNodeErrorHandler = NodeErrorHandler as jest.Mocked<typeof NodeErrorHandler>;

describe('RosApi', () => {
    let node: RosApi;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosApi();
    });

    describe('execute', () => {
        it('should get topics successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockReturnValue('topics');

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getTopics.mockResolvedValue({
                topics: ['/chatter', '/cmd_vel'],
                types: ['std_msgs/String', 'geometry_msgs/Twist'],
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json).toEqual({
                operation: 'topics',
                topics: ['/chatter', '/cmd_vel'],
                types: ['std_msgs/String', 'geometry_msgs/Twist'],
                retrievedAt: expect.any(String),
            });

            expect(mockRosBridgeService.connect).toHaveBeenCalled();
            expect(mockRosApiService.getTopics).toHaveBeenCalled();
            expect(mockRosBridgeService.close).toHaveBeenCalled();
        });

        it('should get services successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockReturnValue('services');

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getServices.mockResolvedValue(['service1', 'service2']);
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                operation: 'services',
                services: ['service1', 'service2'],
                retrievedAt: expect.any(String),
            });

            expect(mockRosApiService.getServices).toHaveBeenCalled();
        });

        it('should get nodes successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockReturnValue('nodes');

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getNodes.mockResolvedValue(['node1', 'node2']);
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                operation: 'nodes',
                nodes: ['node1', 'node2'],
                retrievedAt: expect.any(String),
            });

            expect(mockRosApiService.getNodes).toHaveBeenCalled();
        });

        it('should get action servers successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockReturnValue('actionServers');

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getActionServers.mockResolvedValue(['action1', 'action2']);
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({
                operation: 'actionServers',
                actionServers: ['action1', 'action2'],
                retrievedAt: expect.any(String),
            });

            expect(mockRosApiService.getActionServers).toHaveBeenCalled();
        });

        it('should handle API errors with continueOnFail', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(true),
                getNode: jest.fn().mockReturnValue({}),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockReturnValue('topics');

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosApiService.getTopics.mockRejectedValue(new Error('ROS API unavailable'));
            mockRosBridgeService.close.mockImplementation(() => { });
            mockNodeErrorHandler.buildErrorOutput.mockReturnValue({ error: 'ROS API unavailable' });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({ error: 'ROS API unavailable' });
            expect(mockNodeErrorHandler.handle).not.toHaveBeenCalled();
        });

        it('should handle parameter validation errors', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation(() => {
                throw new Error('Invalid operation');
            });

            mockNodeErrorHandler.handle.mockImplementation(() => {
                throw new Error('Validation error');
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Validation error');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });

        it('should handle unsupported operations', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockReturnValue('unsupported_operation');

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.close.mockImplementation(() => { });

            mockNodeErrorHandler.handle.mockImplementation(() => {
                throw new Error('Unsupported operation: unsupported_operation');
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Unsupported operation: unsupported_operation');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });
    });
});
