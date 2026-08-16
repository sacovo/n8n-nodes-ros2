/**
 * Unit tests for RosActionServerService.
 *
 * The goal-registry cleanup cases are ported from the SimpleActionServer-based
 * predecessor: the invariants (teardown invalidates goals, a reconnected server
 * does not resurrect old ones, teardown is scoped to its own server) still
 * matter now that the server is a ROS 2 `Action` advertised through rosbridge.
 */

import { RosActionServerService } from '../services/RosActionServerService';
import type { JsonRecord } from '../services/RosBridgeService';
import type { Ros } from 'roslib';

/** Minimal stand-in for roslib's ROS 2 Action in server mode. */
class FakeAction {
    static instances: FakeAction[] = [];

    feedback: Array<{ goalId: string; feedback: JsonRecord }> = [];
    succeeded: Array<{ goalId: string; result: JsonRecord }> = [];
    canceled: Array<{ goalId: string; result: JsonRecord }> = [];
    failed: string[] = [];
    unadvertised = false;

    private goalCallback?: (goal: JsonRecord, goalId: string) => void;
    private cancelCallback?: (goalId: string) => void;

    constructor() {
        FakeAction.instances.push(this);
    }

    advertise(
        goalCallback: (goal: JsonRecord, goalId: string) => void,
        cancelCallback: (goalId: string) => void,
    ): void {
        this.goalCallback = goalCallback;
        this.cancelCallback = cancelCallback;
    }

    unadvertise(): void {
        this.unadvertised = true;
    }

    sendFeedback(goalId: string, feedback: JsonRecord): void {
        this.feedback.push({ goalId, feedback });
    }

    setSucceeded(goalId: string, result: JsonRecord): void {
        this.succeeded.push({ goalId, result });
    }

    setCanceled(goalId: string, result: JsonRecord): void {
        this.canceled.push({ goalId, result });
    }

    setFailed(goalId: string): void {
        this.failed.push(goalId);
    }

    /** Simulates rosbridge forwarding a client goal to this server. */
    receiveGoal(goalId: string, goal: JsonRecord): void {
        this.goalCallback?.(goal, goalId);
    }

    /** Simulates a client cancel request. */
    receiveCancel(goalId: string): void {
        this.cancelCallback?.(goalId);
    }
}

const mockRos = {} as unknown as Ros;

const advertise = (
    serverName: string,
    onGoal: (goal: JsonRecord, goalId: string) => void = () => { },
    onCancel: (goalId: string) => void = () => { },
) =>
    RosActionServerService.advertise(
        mockRos,
        serverName,
        'example_interfaces/action/Fibonacci',
        onGoal,
        onCancel,
    );

describe('RosActionServerService', () => {
    beforeEach(() => {
        FakeAction.instances = [];
        jest.spyOn(
            RosActionServerService as unknown as { loadRoslib: () => Promise<unknown> },
            'loadRoslib',
        ).mockResolvedValue({ Action: FakeAction });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('forwards incoming goals and cancel requests to the callbacks', async () => {
        const goals: Array<[JsonRecord, string]> = [];
        const cancels: string[] = [];
        const teardown = await advertise(
            '/fibonacci',
            (goal, goalId) => goals.push([goal, goalId]),
            (goalId) => cancels.push(goalId),
        );

        const server = FakeAction.instances[0];
        server.receiveGoal('goal_1', { order: 5 });
        server.receiveCancel('goal_1');

        expect(goals).toEqual([[{ order: 5 }, 'goal_1']]);
        expect(cancels).toEqual(['goal_1']);

        teardown();
    });

    it('routes feedback and each terminal state to the advertised action', async () => {
        const teardown = await advertise('/fibonacci');
        const server = FakeAction.instances[0];

        server.receiveGoal('goal_fb', {});
        RosActionServerService.sendFeedback('goal_fb', { partial_sequence: [0, 1] });
        expect(server.feedback).toEqual([
            { goalId: 'goal_fb', feedback: { partial_sequence: [0, 1] } },
        ]);

        server.receiveGoal('goal_ok', {});
        RosActionServerService.setSucceeded('goal_ok', { sequence: [0, 1, 1] });
        expect(server.succeeded).toEqual([{ goalId: 'goal_ok', result: { sequence: [0, 1, 1] } }]);

        server.receiveGoal('goal_cancel', {});
        RosActionServerService.setCanceled('goal_cancel', { sequence: [] });
        expect(server.canceled).toEqual([{ goalId: 'goal_cancel', result: { sequence: [] } }]);

        server.receiveGoal('goal_fail', {});
        RosActionServerService.setFailed('goal_fail');
        expect(server.failed).toEqual(['goal_fail']);

        teardown();
    });

    it('forgets a goal once it reaches a terminal state', async () => {
        const teardown = await advertise('/fibonacci');
        FakeAction.instances[0].receiveGoal('goal_1', {});

        RosActionServerService.setSucceeded('goal_1', {});

        expect(() => RosActionServerService.sendFeedback('goal_1', {})).toThrow(
            'No active action goal found for ID "goal_1"',
        );

        teardown();
    });

    it('drops goals received before teardown so stale feedback fails loudly', async () => {
        const teardown = await advertise('/fibonacci');
        const server = FakeAction.instances[0];
        server.receiveGoal('goal_1', { order: 5 });

        expect(() =>
            RosActionServerService.sendFeedback('goal_1', { partial_sequence: [1] }),
        ).not.toThrow();

        teardown();

        expect(server.unadvertised).toBe(true);
        expect(() => RosActionServerService.sendFeedback('goal_1', {})).toThrow(
            'No active action goal found for ID "goal_1"',
        );
    });

    it('a reconnected server does not resurrect goals from the previous server', async () => {
        const firstTeardown = await advertise('/fibonacci');
        FakeAction.instances[0].receiveGoal('goal_old', { order: 3 });

        // Simulate reconnect: old teardown runs, a new server is advertised.
        firstTeardown();
        const secondTeardown = await advertise('/fibonacci');

        expect(() => RosActionServerService.sendFeedback('goal_old', {})).toThrow(
            'No active action goal found for ID "goal_old"',
        );

        secondTeardown();
    });

    it('teardown only removes goals for its own server', async () => {
        const firstTeardown = await advertise('/a');
        const secondTeardown = await advertise('/b');

        const [firstServer, secondServer] = FakeAction.instances;
        firstServer.receiveGoal('goal_a', {});
        secondServer.receiveGoal('goal_b', {});

        firstTeardown();

        expect(() => RosActionServerService.sendFeedback('goal_a', {})).toThrow(
            'No active action goal found for ID "goal_a"',
        );
        // The second server's goal is untouched.
        expect(() => RosActionServerService.sendFeedback('goal_b', {})).not.toThrow();
        expect(secondServer.feedback).toEqual([{ goalId: 'goal_b', feedback: {} }]);

        secondTeardown();
    });
});
