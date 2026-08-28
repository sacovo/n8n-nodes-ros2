/**
 * Unit tests for the RosAction node - parameter plumbing and operation
 * dispatch. What actually goes over the wire is covered by
 * RosActionService.test.ts (unit) and test/system (against a real rosbridge).
 */

import { RosAction } from '../RosAction.node';
import { RosActionService } from '../../shared/services/RosActionService';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import { NodeErrorHandler } from '../../shared/utils/NodeErrorHandler';
import type { IExecuteFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

jest.mock('../../shared/services/RosActionService');
jest.mock('../../shared/services/RosBridgeService');
jest.mock('../../shared/utils/MessageTypeValidator', () => ({
    MessageTypeValidator: {
        validateAgainstType: jest.fn(async (payload: unknown) => payload),
    },
}));

const mockActionService = RosActionService as jest.Mocked<typeof RosActionService>;
const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;

/** Builds an IExecuteFunctions whose getNodeParameter reads from `params`. */
function makeExecuteFunctions(
    params: Record<string, unknown>,
    credentials: Record<string, unknown> = {},
): IExecuteFunctions {
    return {
        getInputData: jest.fn().mockReturnValue([{}]),
        getCredentials: jest.fn().mockResolvedValue(credentials),
        continueOnFail: jest.fn().mockReturnValue(false),
        getNodeParameter: jest.fn((name: string) => params[name]),
        getNode: jest.fn().mockReturnValue({ name: 'ROS2 Action', type: 'rosAction' }),
    } as unknown as IExecuteFunctions;
}

/** Same, but with a credential whose read-only switch is on. */
function createReadOnlyContext(params: Record<string, unknown>): IExecuteFunctions {
    return makeExecuteFunctions(params, { readOnly: true });
}

describe('RosAction', () => {
    let node: RosAction;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosAction();
        mockRosBridgeService.connect.mockResolvedValue({} as unknown as Ros);
        jest.spyOn(NodeErrorHandler, 'shouldReturnErrorOutput').mockReturnValue(false);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('sends a goal and waits, returning the decoded status', async () => {
        mockActionService.sendGoalAndWait.mockResolvedValue({
            handleId: 'n8n:/fibonacci:abc',
            serverName: '/fibonacci',
            actionType: 'example_interfaces/action/Fibonacci',
            statusCode: 4,
            status: 'SUCCEEDED',
            succeeded: true,
            result: { sequence: [0, 1, 1, 2] },
            feedback: [],
        });

        const result = await node.execute.call(
            makeExecuteFunctions({
                operation: 'sendGoalAndWait',
                serverName: { mode: 'id', value: '/fibonacci' },
                actionType: { mode: 'id', value: 'example_interfaces/action/Fibonacci' },
                goalInputMode: 'raw',
                goalJson: '{"order":4}',
                includeFeedback: false,
                timeoutMs: 30000,
            }),
        );

        expect(mockActionService.sendGoalAndWait).toHaveBeenCalledWith(
            expect.anything(),
            '/fibonacci',
            'example_interfaces/action/Fibonacci',
            { order: 4 },
            30000,
            false,
        );
        expect(result[0][0].json).toMatchObject({
            goalHandle: 'n8n:/fibonacci:abc',
            status: 'SUCCEEDED',
            succeeded: true,
            result: { sequence: [0, 1, 1, 2] },
        });
        expect(result[0][0].json).not.toHaveProperty('feedback');
    });

    it('includes feedback when asked for', async () => {
        mockActionService.sendGoalAndWait.mockResolvedValue({
            handleId: 'n8n:/fibonacci:abc',
            serverName: '/fibonacci',
            actionType: 'example_interfaces/action/Fibonacci',
            statusCode: 4,
            status: 'SUCCEEDED',
            succeeded: true,
            result: {},
            feedback: [{ partial_sequence: [0, 1] }],
        });

        const result = await node.execute.call(
            makeExecuteFunctions({
                operation: 'sendGoalAndWait',
                serverName: { mode: 'id', value: '/fibonacci' },
                actionType: { mode: 'id', value: 'example_interfaces/action/Fibonacci' },
                goalInputMode: 'raw',
                goalJson: '{}',
                includeFeedback: true,
                timeoutMs: 30000,
            }),
        );

        expect(result[0][0].json.feedback).toEqual([{ partial_sequence: [0, 1] }]);
    });

    it('returns the goal handle without waiting for sendGoal', async () => {
        mockActionService.sendGoal.mockReturnValue({
            handleId: 'n8n:/fibonacci:xyz',
            serverName: '/fibonacci',
            actionType: 'example_interfaces/action/Fibonacci',
        });

        const result = await node.execute.call(
            makeExecuteFunctions({
                operation: 'sendGoal',
                serverName: { mode: 'id', value: '/fibonacci' },
                actionType: { mode: 'id', value: 'example_interfaces/action/Fibonacci' },
                goalInputMode: 'raw',
                goalJson: '{"order":9}',
                includeFeedback: false,
            }),
        );

        expect(mockActionService.sendGoal).toHaveBeenCalled();
        expect(result[0][0].json.goalHandle).toBe('n8n:/fibonacci:xyz');
        expect(result[0][0].json).not.toHaveProperty('result');
    });

    it('cancels by goal handle', async () => {
        mockActionService.cancelGoal.mockReturnValue({
            handleId: 'n8n:/fibonacci:xyz',
            serverName: '/fibonacci',
            actionType: 'example_interfaces/action/Fibonacci',
        });

        const result = await node.execute.call(
            makeExecuteFunctions({
                operation: 'cancelGoal',
                goalHandle: 'n8n:/fibonacci:xyz',
            }),
        );

        expect(mockActionService.cancelGoal).toHaveBeenCalledWith('n8n:/fibonacci:xyz');
        expect(result[0][0].json.goalHandle).toBe('n8n:/fibonacci:xyz');
    });

    it('reports watchStatus results', async () => {
        mockActionService.waitForStatus.mockResolvedValue({
            goals: [
                {
                    goalId: '123e4567-e89b-12d3-a456-426614174000',
                    statusCode: 2,
                    status: 'EXECUTING',
                },
            ],
            raw: { status_list: [] },
        });

        const result = await node.execute.call(
            makeExecuteFunctions({
                operation: 'watchStatus',
                serverName: { mode: 'id', value: '/fibonacci' },
                goalId: '',
                watchTimeoutMs: 5000,
            }),
        );

        expect(mockActionService.waitForStatus).toHaveBeenCalledWith(
            expect.anything(),
            '/fibonacci',
            5000,
            undefined,
        );
        expect(result[0][0].json.goals).toHaveLength(1);
    });

    describe('read-only credential', () => {
        beforeEach(() => {
            jest.spyOn(NodeErrorHandler, 'shouldReturnErrorOutput').mockReturnValue(true);
            jest.spyOn(NodeErrorHandler, 'buildErrorOutput').mockImplementation((error) => ({
                error: (error as Error).message,
            }));
        });

        const goalParams = {
            serverName: { mode: 'id', value: '/fibonacci' },
            actionType: { mode: 'id', value: 'example_interfaces/action/Fibonacci' },
            goalInputMode: 'raw',
            goalJson: '{}',
            includeFeedback: false,
            timeoutMs: 1000,
            goalHandle: 'n8n:/fibonacci:xyz',
        };

        it.each(['sendGoal', 'sendGoalAndWait', 'cancelGoal'] as const)(
            'refuses %s, since it drives the robot',
            async (operation) => {
                const context = createReadOnlyContext({ ...goalParams, operation });

                const result = await node.execute.call(context);

                expect(result[0][0].json.error).toContain('read-only');
                expect(mockActionService.sendGoal).not.toHaveBeenCalled();
                expect(mockActionService.sendGoalAndWait).not.toHaveBeenCalled();
                expect(mockActionService.cancelGoal).not.toHaveBeenCalled();
                // The guard runs before the node touches the connection.
                expect(mockRosBridgeService.connect).not.toHaveBeenCalled();
            },
        );

        it('still allows watching status, which only observes', async () => {
            mockActionService.waitForStatus.mockResolvedValue({ goals: [], raw: {} });
            const context = createReadOnlyContext({
                operation: 'watchStatus',
                serverName: { mode: 'id', value: '/fibonacci' },
                goalId: '',
                watchTimeoutMs: 5000,
            });

            await node.execute.call(context);

            expect(mockActionService.waitForStatus).toHaveBeenCalled();
        });
    });

    it('returns the error as output when running as an AI tool', async () => {
        jest.spyOn(NodeErrorHandler, 'shouldReturnErrorOutput').mockReturnValue(true);
        mockActionService.sendGoalAndWait.mockRejectedValue(new Error('no action server'));

        const result = await node.execute.call(
            makeExecuteFunctions({
                operation: 'sendGoalAndWait',
                serverName: { mode: 'id', value: '/missing' },
                actionType: { mode: 'id', value: 'example_interfaces/action/Fibonacci' },
                goalInputMode: 'raw',
                goalJson: '{}',
                includeFeedback: false,
                timeoutMs: 1000,
            }),
        );

        expect(result[0][0].json).toHaveProperty('error');
    });
});
