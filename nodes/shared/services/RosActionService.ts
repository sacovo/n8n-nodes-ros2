/**
 * RosActionService - ROS 2 actions over rosbridge's native action protocol.
 *
 * Goals go out as `send_action_goal` ops and come back as `action_feedback` /
 * `action_result` ops on the same websocket, correlated by a client-chosen id.
 *
 * Why not the `<action>/_action/send_goal|get_result|cancel_goal` services:
 * rosbridge cannot reach them at all, for two independent reasons.
 *   1. They are *hidden* names (the `_action` segment starts with `_`), and
 *      rosbridge resolves `call_service` against
 *      `Node.get_service_names_and_types()`, which excludes hidden services -
 *      so the lookup raises InvalidServiceException before anything is sent.
 *      This is the same reason `rosapi/service_type` cannot report their type
 *      (see RosApiService.getActionType).
 *   2. Even given the name, `ros_loader.get_service_class` resolves
 *      `pkg/action/X_SendGoal` as `getattr(pkg.action, 'X_SendGoal')`, and the
 *      generated `action/__init__.py` exports only `X_SendGoal_Request`,
 *      `X_SendGoal_Response`, `X_SendGoal_Event` and the bare `X` - never the
 *      service class itself. `ros_loader` special-cases exactly one name shape,
 *      `_FeedbackMessage`, which is why the feedback and status *topics* used
 *      further down do work.
 *
 * The consequence that shapes the nodes: rosbridge never reports a goal's ROS
 * UUID back to the client. A goal is identified only by the correlation id we
 * chose, on the connection we sent it from. Goals are therefore tracked in the
 * in-process registry below so cancel/result can find them again, which is why
 * those operations only work within the n8n process that started the goal.
 *
 * Note that `send_action_goal` blocks rosbridge's per-connection message queue
 * unless the server runs with `send_action_goals_in_new_thread` (the stock
 * `rosbridge_websocket_launch.xml` defaults it to true). With it disabled, a
 * long-running goal stalls every other operation on the shared pooled
 * connection, and cancels for it are never dispatched.
 */

import { randomUUID } from 'node:crypto';

import type { Ros } from 'roslib';

import { RosBridgeService, RosBridgeTimeoutError, type JsonRecord } from './RosBridgeService';

/** action_msgs/msg/GoalStatus */
export const GOAL_STATUS_LABELS: Record<number, string> = {
    0: 'UNKNOWN',
    1: 'ACCEPTED',
    2: 'EXECUTING',
    3: 'CANCELING',
    4: 'SUCCEEDED',
    5: 'CANCELED',
    6: 'ABORTED',
};

const STATUS_SUCCEEDED = 4;

export interface ActionGoalHandle {
    handleId: string;
    serverName: string;
    actionType: string;
}

export interface ActionOutcome {
    handleId: string;
    serverName: string;
    actionType: string;
    statusCode: number;
    status: string;
    succeeded: boolean;
    result: JsonRecord | null;
    /** Set when rosbridge reported `result: false` (rejected goal, server error). */
    error?: string;
    feedback: JsonRecord[];
}

export interface ActionStatusEntry {
    goalId: string | null;
    statusCode: number;
    status: string;
    stamp?: JsonRecord;
}

interface PendingGoal {
    handleId: string;
    ros: Ros;
    serverName: string;
    actionType: string;
    feedback: JsonRecord[];
    listener: (message: unknown) => void;
    settled: boolean;
    outcome?: ActionOutcome;
    waiters: Array<{
        resolve: (outcome: ActionOutcome) => void;
        reject: (error: Error) => void;
    }>;
}

/** Shape of the rosbridge `action_result` / `action_feedback` messages. */
interface ActionStreamMessage {
    op?: string;
    status?: number;
    result?: boolean;
    values?: unknown;
}

export class RosActionService {
    private static pendingGoals = new Map<string, PendingGoal>();

    /**
     * rosapi reports action types either fully qualified
     * (`pkg/action/Fibonacci`) or in the short ROS 1 style (`pkg/Fibonacci`).
     * rosbridge's loader wants the middle segment, so normalize before use.
     */
    static normalizeActionType(actionType: string): string {
        const parts = actionType.split('/').filter(Boolean);
        if (parts.length === 2) {
            return `${parts[0]}/action/${parts[1]}`;
        }
        return parts.join('/');
    }

    private static trimServerName(serverName: string): string {
        return serverName.endsWith('/') ? serverName.slice(0, -1) : serverName;
    }

    static feedbackTopic(serverName: string): string {
        return `${this.trimServerName(serverName)}/_action/feedback`;
    }

    static statusTopic(serverName: string): string {
        return `${this.trimServerName(serverName)}/_action/status`;
    }

    static feedbackMessageType(actionType: string): string {
        return `${this.normalizeActionType(actionType)}_FeedbackMessage`;
    }

    /**
     * Decodes a `unique_identifier_msgs/UUID` as it arrives over rosbridge.
     * `uint8[16]` is a binary field, so rosbridge base64-encodes it on the way
     * out, but accepts (and older/CBOR paths emit) a plain byte array too.
     * Returned in canonical 8-4-4-4-12 hex form.
     */
    static decodeGoalUuid(value: unknown): string | null {
        const raw = (value as { uuid?: unknown })?.uuid ?? value;

        let bytes: Buffer | undefined;
        if (typeof raw === 'string') {
            bytes = Buffer.from(raw, 'base64');
        } else if (Array.isArray(raw)) {
            bytes = Buffer.from(raw as number[]);
        }

        if (!bytes || bytes.length !== 16) {
            return null;
        }

        const hex = bytes.toString('hex');
        return [
            hex.slice(0, 8),
            hex.slice(8, 12),
            hex.slice(12, 16),
            hex.slice(16, 20),
            hex.slice(20),
        ].join('-');
    }

    private static statusLabel(statusCode: number): string {
        return GOAL_STATUS_LABELS[statusCode] ?? 'UNKNOWN';
    }

    /**
     * Sends a goal and returns as soon as it is on the wire. The result is
     * collected in the background; await it with {@link awaitOutcome} or drop
     * it with {@link forgetGoal}.
     */
    static sendGoal(
        ros: Ros,
        serverName: string,
        actionType: string,
        goal: JsonRecord,
        collectFeedback = true,
    ): ActionGoalHandle {
        const action = this.trimServerName(serverName);
        const normalizedType = this.normalizeActionType(actionType);
        // rosbridge returns this id verbatim on every feedback/result message
        // for the goal, and matches it when cancelling (`extract_id`).
        const handleId = `n8n:${action}:${randomUUID()}`;

        const pending: PendingGoal = {
            handleId,
            ros,
            serverName: action,
            actionType: normalizedType,
            feedback: [],
            settled: false,
            waiters: [],
            listener: () => { },
        };

        pending.listener = (message: unknown) => {
            const msg = (message || {}) as ActionStreamMessage;

            if (msg.op === 'action_feedback') {
                if (collectFeedback) {
                    pending.feedback.push((msg.values || {}) as JsonRecord);
                }
                return;
            }

            if (msg.op !== 'action_result') {
                return;
            }

            const statusCode = typeof msg.status === 'number' ? msg.status : 0;
            // rosbridge sets `result: false` for a rejected goal or a server
            // exception, and then `values` is an error string rather than the
            // action result. Surface that as data, not as a thrown error, so a
            // CANCELED or ABORTED goal still reports its status.
            const failed = msg.result === false;

            this.settle(pending, {
                handleId,
                serverName: action,
                actionType: normalizedType,
                statusCode,
                status: this.statusLabel(statusCode),
                succeeded: !failed && statusCode === STATUS_SUCCEEDED,
                result: failed ? null : ((msg.values || {}) as JsonRecord),
                ...(failed ? { error: String(msg.values ?? 'Action failed') } : {}),
                feedback: pending.feedback,
            });
        };

        this.pendingGoals.set(handleId, pending);
        ros.on(handleId, pending.listener);

        ros.callOnConnection({
            op: 'send_action_goal',
            id: handleId,
            action,
            action_type: normalizedType,
            args: goal,
            feedback: collectFeedback,
        });

        return { handleId, serverName: action, actionType: normalizedType };
    }

    private static settle(pending: PendingGoal, outcome: ActionOutcome): void {
        if (pending.settled) {
            return;
        }
        pending.settled = true;
        pending.outcome = outcome;
        pending.ros.off(pending.handleId, pending.listener);

        for (const waiter of pending.waiters.splice(0)) {
            waiter.resolve(outcome);
        }
    }

    /**
     * Waits for the result of a goal started in this process. Leaves the goal
     * pending on timeout so a later call can still pick it up - the goal keeps
     * running on the robot either way.
     */
    static async awaitOutcome(handleId: string, timeoutMs: number): Promise<ActionOutcome> {
        const pending = this.pendingGoals.get(handleId);
        if (!pending) {
            throw new Error(
                `No pending goal "${handleId}". Goals can only be awaited by the same n8n process that started them, and only until their result arrives.`,
            );
        }

        if (pending.outcome) {
            this.pendingGoals.delete(handleId);
            return pending.outcome;
        }

        return new Promise<ActionOutcome>((resolve, reject) => {
            const timer = setTimeout(() => {
                const index = pending.waiters.findIndex((waiter) => waiter.resolve === onResolve);
                if (index !== -1) {
                    pending.waiters.splice(index, 1);
                }
                reject(
                    new RosBridgeTimeoutError(
                        `Timed out after ${timeoutMs}ms waiting for the result of "${pending.serverName}". The goal is still running - cancel it explicitly if that is not wanted.`,
                    ),
                );
            }, timeoutMs);

            const onResolve = (outcome: ActionOutcome) => {
                clearTimeout(timer);
                this.pendingGoals.delete(handleId);
                resolve(outcome);
            };

            pending.waiters.push({ resolve: onResolve, reject });
        });
    }

    static async sendGoalAndWait(
        ros: Ros,
        serverName: string,
        actionType: string,
        goal: JsonRecord,
        timeoutMs: number,
        collectFeedback = true,
    ): Promise<ActionOutcome> {
        const handle = this.sendGoal(ros, serverName, actionType, goal, collectFeedback);
        return this.awaitOutcome(handle.handleId, timeoutMs);
    }

    /**
     * Asks the action server to cancel a goal started in this process.
     * rosbridge always dispatches `cancel_action_goal` on its own thread, so
     * this is delivered even while the goal is in flight.
     */
    static cancelGoal(handleId: string): ActionGoalHandle {
        const pending = this.pendingGoals.get(handleId);
        if (!pending) {
            throw new Error(
                `No pending goal "${handleId}". Goals can only be cancelled by the same n8n process that started them, and only before their result arrives.`,
            );
        }

        pending.ros.callOnConnection({
            op: 'cancel_action_goal',
            id: handleId,
            action: pending.serverName,
        });

        return {
            handleId,
            serverName: pending.serverName,
            actionType: pending.actionType,
        };
    }

    /** Drops a pending goal without waiting for it. The goal itself keeps running. */
    static forgetGoal(handleId: string): void {
        const pending = this.pendingGoals.get(handleId);
        if (!pending) {
            return;
        }
        pending.ros.off(pending.handleId, pending.listener);
        this.pendingGoals.delete(handleId);
    }

    /** Number of goals still awaiting a result. Exposed for tests. */
    static pendingGoalCount(): number {
        return this.pendingGoals.size;
    }

    /**
     * Waits for the next message on `<server>/_action/feedback`. Unlike
     * {@link awaitOutcome} this is a plain topic subscription, so it observes
     * goals started anywhere - including from other processes or `ros2 action
     * send_goal` - and reports the ROS goal UUID each message belongs to.
     */
    static async waitForFeedback(
        ros: Ros,
        serverName: string,
        actionType: string,
        timeoutMs: number,
        goalId?: string,
    ): Promise<{ goalId: string | null; feedback: JsonRecord }> {
        const message = await RosBridgeService.waitForTopicMessage(
            ros,
            this.feedbackTopic(serverName),
            this.feedbackMessageType(actionType),
            timeoutMs,
            goalId
                ? (candidate) => this.decodeGoalUuid(candidate.goal_id) === goalId
                : undefined,
        );

        return {
            goalId: this.decodeGoalUuid(message.goal_id),
            feedback: (message.feedback || {}) as JsonRecord,
        };
    }

    /**
     * Reads the next `<server>/_action/status` message. Like the feedback
     * topic this covers every goal on the server, not just ours.
     */
    static async waitForStatus(
        ros: Ros,
        serverName: string,
        timeoutMs: number,
        goalId?: string,
    ): Promise<{ goals: ActionStatusEntry[]; raw: JsonRecord }> {
        const message = await RosBridgeService.waitForTopicMessage(
            ros,
            this.statusTopic(serverName),
            'action_msgs/msg/GoalStatusArray',
            timeoutMs,
        );

        const statusList = Array.isArray(message.status_list)
            ? (message.status_list as Array<Record<string, unknown>>)
            : [];

        const goals = statusList.map((entry) => {
            // ROS 2 nests the id one level deeper than ROS 1 did:
            // status_list[].goal_info.goal_id.uuid
            const goalInfo = (entry.goal_info || {}) as Record<string, unknown>;
            const statusCode = Number(entry.status ?? 0);
            return {
                goalId: this.decodeGoalUuid(goalInfo.goal_id),
                statusCode,
                status: this.statusLabel(statusCode),
                stamp: goalInfo.stamp as JsonRecord | undefined,
            };
        });

        return {
            goals: goalId ? goals.filter((entry) => entry.goalId === goalId) : goals,
            raw: message,
        };
    }
}
