/**
 * Unit tests for RosServiceCall node
 */

import { RosServiceCall } from '../RosServiceCall.node';
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

describe('RosServiceCall', () => {
    let node: RosServiceCall;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosServiceCall();
    });

    describe('execute', () => {
        it('should call service successfully', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'serviceName') return '/add_two_ints';
                    if (name === 'serviceType') return 'example_interfaces/srv/AddTwoInts';
                    if (name === 'requestJson') return '{"a": 5, "b": 3}';
                    if (name === 'timeoutMs') return 10000;
                    return undefined;
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockReturnValue('example_interfaces/srv/AddTwoInts');
            mockParameterExtractor.extractRequiredNumber.mockReturnValue(10000);
            mockParameterExtractor.parseJsonParameter.mockReturnValue({ a: 5, b: 3 });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.callService.mockResolvedValue({
                sum: 8,
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json).toEqual({
                serviceName: '/add_two_ints',
                serviceType: 'example_interfaces/srv/AddTwoInts',
                request: { a: 5, b: 3 },
                response: { sum: 8 },
            });

            expect(mockRosBridgeService.connect).toHaveBeenCalled();
            expect(mockRosBridgeService.callService).toHaveBeenCalledWith(
                {},
                '/add_two_ints',
                'example_interfaces/srv/AddTwoInts',
                { a: 5, b: 3 },
                expect.any(Number),
            );
            expect(mockRosBridgeService.close).toHaveBeenCalled();
        });

        it('should handle service call errors with continueOnFail', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(true),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'serviceName') return '/nonexistent_service';
                    if (name === 'requestJson') return '{}';
                    if (name === 'timeoutMs') return 10000;
                    return undefined;
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString
                .mockReturnValueOnce('/nonexistent_service')
                .mockReturnValueOnce('std_srvs/srv/Empty');
            mockParameterExtractor.extractJsonParameter.mockReturnValue({});

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.callService.mockRejectedValue(new Error('Service not available'));
            mockRosBridgeService.close.mockImplementation(() => { });
            mockNodeErrorHandler.buildErrorOutput.mockReturnValue({ error: 'Service not available' });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({ error: 'Service not available' });
            expect(mockNodeErrorHandler.handle).not.toHaveBeenCalled();
        });

        it('should handle parameter validation errors', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'serviceName') {
                        throw new Error('Invalid service name');
                    }
                    return undefined;
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation(() => {
                throw new Error('Invalid service name');
            });

            mockNodeErrorHandler.handle.mockImplementation(() => {
                throw new Error('Validation error');
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Validation error');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });

        it('should handle invalid JSON request parameters', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNode: jest.fn().mockReturnValue({}),
                getNodeParameter: jest.fn().mockImplementation((name) => {
                    if (name === 'serviceName') return '/test_service';
                    if (name === 'requestJson') return '{"invalid":}';
                    if (name === 'timeoutMs') return 10000;
                    return undefined;
                }),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString
                .mockReturnValueOnce('/test_service')
                .mockReturnValueOnce('std_srvs/srv/Empty');
            mockParameterExtractor.extractJsonParameter.mockImplementation(() => {
                throw new Error('Invalid JSON format');
            });

            mockNodeErrorHandler.handle.mockImplementation(() => {
                throw new Error('Parameter error');
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Parameter error');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });
    });
});
