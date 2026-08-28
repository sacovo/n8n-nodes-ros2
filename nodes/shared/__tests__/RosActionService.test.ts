/**
 * Unit tests for RosActionService.
 *
 * These assert the actual rosbridge messages that go over the wire. The
 * predecessor of this service used roslib's ROS 1 `ActionClient`, which
 * advertised `<server>/goal` and subscribed `actionlib_msgs/GoalStatusArray` -
 * a protocol no ROS 2 action server listens to. That survived for so long
 * because the node tests mocked the service wholesale and nothing checked what
 * was sent, so these tests deliberately inspect the ops themselves.
 */

import { RosActionService } from '../services/RosActionService';
import { RosBridgeService, type JsonRecord } from '../services/RosBridgeService';
import type { Ros } from 'roslib';

interface SentMessage {
    op: string;
    id?: string;
    action?: string;
    action_type?: string;
    args?: unknown;
    feedback?: boolean;
}

/** Minimal stand-in for roslib's Ros: records sent ops, drives listeners. */
class FakeRos {
    sent: SentMessage[] = [];
    private listeners = new Map<string, Array<(message: unknown) => void>>();
    offCalls: string[] = [];

    on(event: string, handler: (message: unknown) => void): void {
        const list = this.listeners.get(event) ?? [];
        list.push(handler);
        this.listeners.set(event, list);
    }

    off(event: string, handler: (message: unknown) => void): void {
        this.offCalls.push(event);
        const list = (this.listeners.get(event) ?? []).filter((entry) => entry !== handler);
        this.listeners.set(event, list);
    }

    callOnConnection(message: SentMessage): void {
        this.sent.push(message);
    }

    /** Simulates rosbridge pushing a message for a correlation id. */
    deliver(id: string, message: unknown): void {
        for (const handler of [...(this.listeners.get(id) ?? [])]) {
            handler(message);
        }
    }

    listenerCount(id: string): number {
        return (this.listeners.get(id) ?? []).length;
    }

    asRos(): Ros {
        return this as unknown as Ros;
    }
}

describe('RosActionService', () => {
    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('normalizeActionType', () => {
        it('expands the short ROS 1 style type rosapi sometimes returns', () => {
            expect(RosActionService.normalizeActionType('pkg/Fibonacci')).toBe('pkg/action/Fibonacci');
        });

        it('leaves an already qualified type alone', () => {
            expect(RosActionService.normalizeActionType('pkg/action/Fibonacci')).toBe('pkg/action/Fibonacci');
        });
    });

    describe('topic and type naming', () => {
        it('derives the ROS 2 feedback/status topics and feedback message type', () => {
            expect(RosActionService.feedbackTopic('/fibonacci')).toBe('/fibonacci/_action/feedback');
            expect(RosActionService.statusTopic('/fibonacci')).toBe('/fibonacci/_action/status');
            expect(RosActionService.feedbackMessageType('pkg/Fibonacci')).toBe('pkg/action/Fibonacci_FeedbackMessage');
        });

        it('does not double the slash on a trailing-slash server name', () => {
            expect(RosActionService.statusTopic('/fibonacci/')).toBe('/fibonacci/_action/status');
        });
    });

    describe('decodeGoalUuid', () => {
        const bytes = [0x12, 0x3e, 0x45, 0x67, 0xe8, 0x9b, 0x12, 0xd3, 0xa4, 0x56, 0x42, 0x66, 0x14, 0x17, 0x40, 0x00];
        const expected = '123e4567-e89b-12d3-a456-426614174000';

        it('decodes the base64 form rosbridge sends for uint8[16]', () => {
            const base64 = Buffer.from(bytes).toString('base64');
            expect(RosActionService.decodeGoalUuid({ uuid: base64 })).toBe(expected);
        });

        it('decodes a plain byte array too', () => {
            expect(RosActionService.decodeGoalUuid({ uuid: bytes })).toBe(expected);
        });

        it('returns null for anything that is not 16 bytes', () => {
            expect(RosActionService.decodeGoalUuid({ uuid: [1, 2, 3] })).toBeNull();
            expect(RosActionService.decodeGoalUuid(undefined)).toBeNull();
        });
    });

    describe('sendGoal', () => {
        it('sends a ROS 2 send_action_goal op with the normalized type', () => {
            const ros = new FakeRos();

            const handle = RosActionService.sendGoal(ros.asRos(), '/fibonacci', 'pkg/Fibonacci', { order: 5 }, true);

            expect(ros.sent).toHaveLength(1);
            expect(ros.sent[0]).toEqual({
                op: 'send_action_goal',
                id: handle.handleId,
                action: '/fibonacci',
                action_type: 'pkg/action/Fibonacci',
                args: { order: 5 },
                feedback: true,
            });

            RosActionService.forgetGoal(handle.handleId);
        });

        it('does not request feedback when it was not asked for', () => {
            const ros = new FakeRos();
            const handle = RosActionService.sendGoal(ros.asRos(), '/fibonacci', 'pkg/action/Fibonacci', {}, false);

            expect(ros.sent[0].feedback).toBe(false);
            RosActionService.forgetGoal(handle.handleId);
        });
    });

    describe('awaitOutcome', () => {
        it('resolves with the result and collected feedback on success', async () => {
            const ros = new FakeRos();
            const handle = RosActionService.sendGoal(
                ros.asRos(),
                '/fibonacci',
                'pkg/action/Fibonacci',
                { order: 3 },
                true,
            );

            const pending = RosActionService.awaitOutcome(handle.handleId, 1000);

            ros.deliver(handle.handleId, {
                op: 'action_feedback',
                values: { partial_sequence: [0, 1, 1] },
            });
            ros.deliver(handle.handleId, {
                op: 'action_result',
                status: 4,
                result: true,
                values: { sequence: [0, 1, 1, 2] },
            });

            const outcome = await pending;

            expect(outcome.succeeded).toBe(true);
            expect(outcome.status).toBe('SUCCEEDED');
            expect(outcome.statusCode).toBe(4);
            expect(outcome.result).toEqual({ sequence: [0, 1, 1, 2] });
            expect(outcome.feedback).toEqual([{ partial_sequence: [0, 1, 1] }]);
        });

        it('reports a CANCELED goal as data rather than throwing', async () => {
            // roslib's own Action class routes any non-SUCCEEDED status into the
            // failure callback as a stringified error, losing the status code.
            const ros = new FakeRos();
            const handle = RosActionService.sendGoal(ros.asRos(), '/fibonacci', 'pkg/action/Fibonacci', {}, false);

            const pending = RosActionService.awaitOutcome(handle.handleId, 1000);
            ros.deliver(handle.handleId, {
                op: 'action_result',
                status: 5,
                result: true,
                values: { sequence: [] },
            });

            const outcome = await pending;

            expect(outcome.status).toBe('CANCELED');
            expect(outcome.statusCode).toBe(5);
            expect(outcome.succeeded).toBe(false);
            expect(outcome.error).toBeUndefined();
        });

        it('surfaces a rejected goal (result: false) as an error field', async () => {
            const ros = new FakeRos();
            const handle = RosActionService.sendGoal(ros.asRos(), '/fibonacci', 'pkg/action/Fibonacci', {}, false);

            const pending = RosActionService.awaitOutcome(handle.handleId, 1000);
            ros.deliver(handle.handleId, {
                op: 'action_result',
                status: 0,
                result: false,
                values: 'Action goal was rejected',
            });

            const outcome = await pending;

            expect(outcome.succeeded).toBe(false);
            expect(outcome.result).toBeNull();
            expect(outcome.error).toBe('Action goal was rejected');
        });

        it('removes its listener once settled so pooled connections do not leak', async () => {
            const ros = new FakeRos();
            const handle = RosActionService.sendGoal(ros.asRos(), '/fibonacci', 'pkg/action/Fibonacci', {}, false);

            expect(ros.listenerCount(handle.handleId)).toBe(1);

            const pending = RosActionService.awaitOutcome(handle.handleId, 1000);
            ros.deliver(handle.handleId, { op: 'action_result', status: 4, result: true, values: {} });
            await pending;

            expect(ros.listenerCount(handle.handleId)).toBe(0);
            expect(RosActionService.pendingGoalCount()).toBe(0);
        });

        it('rejects on timeout and says the goal is still running', async () => {
            const ros = new FakeRos();
            const handle = RosActionService.sendGoal(ros.asRos(), '/fibonacci', 'pkg/action/Fibonacci', {}, false);

            await expect(RosActionService.awaitOutcome(handle.handleId, 10)).rejects.toThrow(/still running/);

            RosActionService.forgetGoal(handle.handleId);
        });

        it('rejects for a handle this process never sent', async () => {
            await expect(RosActionService.awaitOutcome('n8n:/nope:missing', 10)).rejects.toThrow(/No pending goal/);
        });
    });

    describe('cancelGoal', () => {
        it('sends cancel_action_goal with the same correlation id', () => {
            const ros = new FakeRos();
            const handle = RosActionService.sendGoal(ros.asRos(), '/fibonacci', 'pkg/action/Fibonacci', {}, false);

            RosActionService.cancelGoal(handle.handleId);

            expect(ros.sent[1]).toEqual({
                op: 'cancel_action_goal',
                id: handle.handleId,
                action: '/fibonacci',
            });

            RosActionService.forgetGoal(handle.handleId);
        });

        it('rejects for a handle this process never sent', () => {
            expect(() => RosActionService.cancelGoal('n8n:/nope:missing')).toThrow(/No pending goal/);
        });
    });

    describe('waitForStatus', () => {
        it('reads the ROS 2 status_list[].goal_info.goal_id nesting', async () => {
            // ROS 1 put the id at status_list[].goal_id.id; reading that shape
            // against a ROS 2 server matched nothing and reported UNKNOWN.
            const uuid = Buffer.from([
                0x12, 0x3e, 0x45, 0x67, 0xe8, 0x9b, 0x12, 0xd3, 0xa4, 0x56, 0x42, 0x66, 0x14, 0x17, 0x40, 0x00,
            ]).toString('base64');

            jest.spyOn(RosBridgeService, 'waitForTopicMessage').mockResolvedValue({
                status_list: [
                    {
                        goal_info: { goal_id: { uuid }, stamp: { sec: 12, nanosec: 0 } },
                        status: 2,
                    },
                ],
            } as unknown as JsonRecord);

            const { goals } = await RosActionService.waitForStatus({} as unknown as Ros, '/fibonacci', 1000);

            expect(goals).toEqual([
                {
                    goalId: '123e4567-e89b-12d3-a456-426614174000',
                    statusCode: 2,
                    status: 'EXECUTING',
                    stamp: { sec: 12, nanosec: 0 },
                },
            ]);
        });

        it('subscribes to the ROS 2 status topic and message type', async () => {
            const spy = jest
                .spyOn(RosBridgeService, 'waitForTopicMessage')
                .mockResolvedValue({ status_list: [] } as unknown as JsonRecord);

            await RosActionService.waitForStatus({} as unknown as Ros, '/fibonacci', 1000);

            expect(spy).toHaveBeenCalledWith(
                expect.anything(),
                '/fibonacci/_action/status',
                'action_msgs/msg/GoalStatusArray',
                1000,
            );
        });

        it('filters to a single goal when one is given', async () => {
            jest.spyOn(RosBridgeService, 'waitForTopicMessage').mockResolvedValue({
                status_list: [
                    { goal_info: { goal_id: { uuid: Buffer.alloc(16, 1).toString('base64') } }, status: 2 },
                    { goal_info: { goal_id: { uuid: Buffer.alloc(16, 2).toString('base64') } }, status: 4 },
                ],
            } as unknown as JsonRecord);

            const { goals } = await RosActionService.waitForStatus(
                {} as unknown as Ros,
                '/fibonacci',
                1000,
                '02020202-0202-0202-0202-020202020202',
            );

            expect(goals).toHaveLength(1);
            expect(goals[0].status).toBe('SUCCEEDED');
        });
    });

    describe('waitForFeedback', () => {
        it('subscribes to the _FeedbackMessage type and unwraps the goal id', async () => {
            const spy = jest.spyOn(RosBridgeService, 'waitForTopicMessage').mockResolvedValue({
                goal_id: { uuid: Buffer.alloc(16, 3).toString('base64') },
                feedback: { partial_sequence: [0, 1] },
            } as unknown as JsonRecord);

            const result = await RosActionService.waitForFeedback(
                {} as unknown as Ros,
                '/fibonacci',
                'pkg/Fibonacci',
                1000,
            );

            expect(spy).toHaveBeenCalledWith(
                expect.anything(),
                '/fibonacci/_action/feedback',
                'pkg/action/Fibonacci_FeedbackMessage',
                1000,
                undefined,
            );
            expect(result).toEqual({
                goalId: '03030303-0303-0303-0303-030303030303',
                feedback: { partial_sequence: [0, 1] },
            });
        });
    });
});
