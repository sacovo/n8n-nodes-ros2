/**
 * Unit tests for RosActionStart node
 */

import { RosActionStart } from '../RosActionStart.node';
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

describe('RosActionStart', () => {
    let node: RosActionStart;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosActionStart();
    });

    describe('execute', () => {
        it('should start an action successfully with raw JSON', async () => {
            // Mock the dependencies
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNodeParameter: jest.fn(),
            } as unknown as IExecuteFunctions;

            (mockExecuteFunctions.getNodeParameter as jest.Mock)
                .mockReturnValueOnce({ mode: 'id', value: 'test-server' }) // serverName
                .mockReturnValueOnce({ mode: 'id', value: 'test-action' }) // actionName
                .mockReturnValueOnce('raw') // goalInputMode
                .mockReturnValueOnce('{"goal":"test"}'); // goalJson

            mockParameterExtractor.extractRequiredNumber.mockReturnValue(1000);
            mockParameterExtractor.parseJsonParameter.mockReturnValue({ goal: 'test' });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.startAction.mockResolvedValue({
                goalId: 'goal-123',
                status: { code: 1 },
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(1);
            expect(result[0][0].json).toEqual({
                serverName: 'test-server',
                actionName: 'test-action',
                goalId: 'goal-123',
                initialStatus: { code: 1 },
                startedAt: expect.any(String),
            });

            expect(mockRosBridgeService.connect).toHaveBeenCalled();
            expect(mockRosBridgeService.startAction).toHaveBeenCalledWith(
                {},
                'test-server',
                'test-action',
                { goal: 'test' },
                1000,
            );
            expect(mockRosBridgeService.close).toHaveBeenCalled();
        });

        it('should start an action successfully with fixed mapper', async () => {
            // Mock the dependencies
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNodeParameter: jest.fn(),
            } as unknown as IExecuteFunctions;

            (mockExecuteFunctions.getNodeParameter as jest.Mock)
                .mockReturnValueOnce({ mode: 'id', value: 'test-server' }) // serverName
                .mockReturnValueOnce({ mode: 'id', value: 'test-action' }) // actionName
                .mockReturnValueOnce('fixed') // goalInputMode
                .mockReturnValueOnce({ value: { goal: 'test' } }); // goalStructure

            mockParameterExtractor.extractRequiredNumber.mockReturnValue(1000);

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.startAction.mockResolvedValue({
                goalId: 'goal-123',
                status: { code: 1 },
            });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json.goalId).toBe('goal-123');
            expect(mockRosBridgeService.startAction).toHaveBeenCalledWith(
                {},
                'test-server',
                'test-action',
                { goal: 'test' },
                1000,
            );
        });

        it('should handle errors when continueOnFail is true', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(true),
                getNodeParameter: jest.fn(),
            } as unknown as IExecuteFunctions;

            (mockExecuteFunctions.getNodeParameter as jest.Mock).mockImplementation(() => {
                throw new Error('Parameter error');
            });

            mockNodeErrorHandler.buildErrorOutput.mockReturnValue({ error: 'Parameter error' });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result[0][0].json).toEqual({ error: 'Parameter error' });
            expect(mockNodeErrorHandler.handle).not.toHaveBeenCalled();
        });

        it('should handle errors when continueOnFail is false', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNodeParameter: jest.fn(),
            } as unknown as IExecuteFunctions;

            mockParameterExtractor.extractRequiredString.mockImplementation(() => {
                throw new Error('Parameter error');
            });

            mockNodeErrorHandler.handle.mockImplementation(() => {
                throw new Error('Handled error');
            });

            await expect(node.execute.call(mockExecuteFunctions)).rejects.toThrow('Handled error');
            expect(mockNodeErrorHandler.handle).toHaveBeenCalled();
        });

        it('should process multiple items', async () => {
            const mockExecuteFunctions = {
                getInputData: jest.fn().mockReturnValue([{}, {}]),
                getCredentials: jest.fn().mockResolvedValue({}),
                continueOnFail: jest.fn().mockReturnValue(false),
                getNodeParameter: jest.fn(),
            } as unknown as IExecuteFunctions;

            (mockExecuteFunctions.getNodeParameter as jest.Mock)
                // First item
                .mockReturnValueOnce({ mode: 'id', value: 'test-server-1' }) // serverName
                .mockReturnValueOnce({ mode: 'id', value: 'test-action-1' }) // actionName
                .mockReturnValueOnce('raw') // goalInputMode
                .mockReturnValueOnce('{"goal":"test-1"}') // goalJson
                // Second item
                .mockReturnValueOnce({ mode: 'id', value: 'test-server-2' }) // serverName
                .mockReturnValueOnce({ mode: 'id', value: 'test-action-2' }) // actionName
                .mockReturnValueOnce('raw') // goalInputMode
                .mockReturnValueOnce('{"goal":"test-2"}'); // goalJson

            mockParameterExtractor.extractRequiredNumber.mockReturnValue(1000);
            mockParameterExtractor.parseJsonParameter
                .mockReturnValueOnce({ goal: 'test-1' })
                .mockReturnValueOnce({ goal: 'test-2' });

            mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
            mockRosBridgeService.startAction
                .mockResolvedValueOnce({
                    goalId: 'goal-123',
                    status: { code: 1 },
                })
                .mockResolvedValueOnce({
                    goalId: 'goal-456',
                    status: { code: 2 },
                });
            mockRosBridgeService.close.mockImplementation(() => { });

            const result = await node.execute.call(mockExecuteFunctions);

            expect(result).toHaveLength(1);
            expect(result[0]).toHaveLength(2);
            expect(result[0][0].json.goalId).toBe('goal-123');
            expect(result[0][1].json.goalId).toBe('goal-456');
        });
    });
});
