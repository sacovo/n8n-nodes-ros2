/**
 * Unit tests for RosActionTrigger node
 */

import { RosActionTrigger } from '../RosActionTrigger.node';
import { RosActionServerService } from '../../shared/services/RosActionServerService';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import type { ITriggerFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

jest.mock('../../shared/services/RosBridgeService');
jest.mock('../../shared/services/RosActionServerService');

const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;
const mockActionServerService = RosActionServerService as jest.Mocked<typeof RosActionServerService>;

function buildTriggerFunctions(
    credentials: Record<string, unknown> = {},
    parameters: Record<string, unknown> = {},
): ITriggerFunctions {
    const params: Record<string, unknown> = {
        serverName: '/fibonacci',
        actionType: 'test_msgs/action/Fibonacci',
        emitCancelRequests: false,
        ...parameters,
    };
    return {
        getCredentials: jest.fn().mockResolvedValue({
            protocol: 'ws',
            host: 'localhost',
            port: 9090,
            ...credentials,
        }),
        getNodeParameter: jest.fn().mockImplementation((name: string) => params[name]),
        getNode: jest.fn().mockReturnValue({ name: 'ROS2 Action Trigger', type: 'rosActionTrigger' }),
        emit: jest.fn(),
    } as unknown as ITriggerFunctions;
}

describe('RosActionTrigger', () => {
    let node: RosActionTrigger;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new RosActionTrigger();
        mockRosBridgeService.connect.mockResolvedValue({ once: jest.fn() } as unknown as Ros);
    });

    it('should advertise an action server and emit incoming goals', async () => {
        const unadvertise = jest.fn();
        mockActionServerService.advertise.mockImplementation(
            async (_ros, _serverName, _actionType, onGoal) => {
                onGoal({ order: 5 }, 'goal-123');
                return unadvertise;
            },
        );

        const triggerFunctions = buildTriggerFunctions();
        const result = await node.trigger.call(triggerFunctions);

        expect(mockActionServerService.advertise).toHaveBeenCalledWith(
            expect.anything(),
            '/fibonacci',
            'test_msgs/action/Fibonacci',
            expect.any(Function),
            expect.any(Function),
        );
        expect(triggerFunctions.emit).toHaveBeenCalledWith([
            [
                {
                    json: expect.objectContaining({
                        eventType: 'goal',
                        goal: { order: 5 },
                        goalId: 'goal-123',
                        serverName: '/fibonacci',
                    }),
                },
            ],
        ]);

        await result.closeFunction?.();
        expect(unadvertise).toHaveBeenCalled();
    });

    it('emits cancel requests only when asked to', async () => {
        mockActionServerService.advertise.mockImplementation(
            async (_ros, _serverName, _actionType, _onGoal, onCancel) => {
                onCancel('goal-123');
                return jest.fn();
            },
        );

        const silent = buildTriggerFunctions({}, { emitCancelRequests: false });
        await node.trigger.call(silent);
        expect(silent.emit).not.toHaveBeenCalled();

        const emitting = buildTriggerFunctions({}, { emitCancelRequests: true });
        await node.trigger.call(emitting);
        expect(emitting.emit).toHaveBeenCalledWith([
            [
                {
                    json: expect.objectContaining({
                        eventType: 'cancel',
                        goalId: 'goal-123',
                        serverName: '/fibonacci',
                    }),
                },
            ],
        ]);
    });

    it('should refuse to advertise an action server with a read-only credential', async () => {
        const triggerFunctions = buildTriggerFunctions({ readOnly: true });

        await expect(node.trigger.call(triggerFunctions)).rejects.toThrow(/read-only/);
        expect(mockActionServerService.advertise).not.toHaveBeenCalled();
        expect(mockRosBridgeService.connect).not.toHaveBeenCalled();
    });
});
