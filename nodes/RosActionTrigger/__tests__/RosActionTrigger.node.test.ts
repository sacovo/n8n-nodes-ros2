/**
 * Unit tests for RosActionTrigger node
 */

import { RosActionTrigger } from '../RosActionTrigger.node';
import { RosBridgeService } from '../../shared/services/RosBridgeService';
import type { ITriggerFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

jest.mock('../../shared/services/RosBridgeService');

const mockRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;

function buildTriggerFunctions(credentials: Record<string, unknown> = {}): ITriggerFunctions {
    return {
        getCredentials: jest.fn().mockResolvedValue({
            protocol: 'ws',
            host: 'localhost',
            port: 9090,
            ...credentials,
        }),
        getNodeParameter: jest.fn().mockImplementation((name: string) => {
            if (name === 'serverName') return '/fibonacci';
            if (name === 'actionName') return 'test_msgs/action/Fibonacci';
            return undefined;
        }),
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

    it('should register an action server and emit incoming goals', async () => {
        const unsubscribe = jest.fn();
        mockRosBridgeService.registerActionServer.mockImplementation(
            async (ros, serverName, actionName, callback) => {
                callback({ order: 5 }, 'goal-123');
                return unsubscribe;
            },
        );

        const triggerFunctions = buildTriggerFunctions();
        const result = await node.trigger.call(triggerFunctions);

        expect(mockRosBridgeService.registerActionServer).toHaveBeenCalledWith(
            expect.anything(),
            '/fibonacci',
            'test_msgs/action/Fibonacci',
            expect.any(Function),
        );
        expect(triggerFunctions.emit).toHaveBeenCalledWith([
            [
                {
                    json: expect.objectContaining({
                        goal: { order: 5 },
                        goalId: 'goal-123',
                        serverName: '/fibonacci',
                    }),
                },
            ],
        ]);

        await result.closeFunction?.();
        expect(unsubscribe).toHaveBeenCalled();
    });

    it('should refuse to register an action server with a read-only credential', async () => {
        const triggerFunctions = buildTriggerFunctions({ readOnly: true });

        await expect(node.trigger.call(triggerFunctions)).rejects.toThrow(/read-only/);
        expect(mockRosBridgeService.registerActionServer).not.toHaveBeenCalled();
        expect(mockRosBridgeService.connect).not.toHaveBeenCalled();
    });
});
