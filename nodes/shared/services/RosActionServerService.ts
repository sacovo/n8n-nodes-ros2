/**
 * RosActionServerService - advertises a ROS 2 action server through rosbridge.
 *
 * This is the mirror image of RosActionService: instead of sending goals we
 * accept them. rosbridge's `advertise_action` op turns the websocket into an
 * action server, forwards each incoming goal as a `send_action_goal` message,
 * and expects `action_feedback` / `action_result` ops back. roslib's `Action`
 * wraps exactly that, so unlike the client path there is nothing to hand-roll.
 *
 * Note this replaces roslib's `SimpleActionServer`, which is ROS 1 actionlib:
 * it advertises `<server>/goal` and subscribes `<server>/status` with
 * `actionlib_msgs/GoalStatusArray`, none of which a ROS 2 action client ever
 * looks at.
 */

import type { Action, Ros } from 'roslib';

import type { JsonRecord } from './RosBridgeService';

type ActionServer = Action<JsonRecord, JsonRecord, JsonRecord>;

interface RegisteredGoal {
    action: ActionServer;
    serverName: string;
}

export class RosActionServerService {
    private static goalRegistry = new Map<string, RegisteredGoal>();

    private static loadRoslib() {
        // We use eval('import(...)') to prevent tsc from transpiling this to require(),
        // as roslib 2.x is an ESM-only package and doesn't support require().
        return (0, eval)('import("roslib")') as Promise<typeof import('roslib')>;
    }

    /**
     * Advertises `serverName` as a ROS 2 action server. `onGoal` fires for each
     * incoming goal, `onCancel` when a client requests cancellation of one.
     * Returns a teardown function that unadvertises and invalidates every goal
     * registered against this server.
     */
    static async advertise(
        ros: Ros,
        serverName: string,
        actionType: string,
        onGoal: (goal: JsonRecord, goalId: string) => void,
        onCancel: (goalId: string) => void,
    ): Promise<() => void> {
        const { Action } = await this.loadRoslib();

        const action = new Action({
            ros,
            name: serverName,
            actionType,
        }) as ActionServer;

        action.advertise(
            (goal, goalId) => {
                this.goalRegistry.set(goalId, { action, serverName });
                onGoal((goal || {}) as JsonRecord, goalId);
            },
            (goalId) => {
                onCancel(goalId);
            },
        );

        return () => {
            action.unadvertise();
            // Drop every goal registered against this server. On trigger
            // deactivation this prevents unbounded growth from goals that were
            // never completed; on reconnect (connectWithReconnect tears down and
            // re-advertises a fresh Action) it invalidates goalIds that would
            // otherwise point at a dead server, so feedback/result calls fail
            // loudly instead of silently talking to it.
            for (const [goalId, registered] of this.goalRegistry.entries()) {
                if (registered.action === action) {
                    this.goalRegistry.delete(goalId);
                }
            }
        };
    }

    private static resolve(goalId: string): RegisteredGoal {
        const registered = this.goalRegistry.get(goalId);
        if (!registered) {
            throw new Error(
                `No active action goal found for ID "${goalId}". Goals are only known to the n8n process whose ROS2 Action Trigger received them, and only until they are completed.`,
            );
        }
        return registered;
    }

    static sendFeedback(goalId: string, feedback: JsonRecord): void {
        this.resolve(goalId).action.sendFeedback(goalId, feedback);
    }

    static setSucceeded(goalId: string, result: JsonRecord): void {
        this.resolve(goalId).action.setSucceeded(goalId, result);
        this.goalRegistry.delete(goalId);
    }

    static setCanceled(goalId: string, result: JsonRecord): void {
        this.resolve(goalId).action.setCanceled(goalId, result);
        this.goalRegistry.delete(goalId);
    }

    static setFailed(goalId: string): void {
        this.resolve(goalId).action.setFailed(goalId);
        this.goalRegistry.delete(goalId);
    }

    /** Number of goals currently held open. Exposed for tests. */
    static activeGoalCount(): number {
        return this.goalRegistry.size;
    }
}
