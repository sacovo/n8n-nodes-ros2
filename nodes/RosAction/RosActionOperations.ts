import type { IDataObject, IExecuteFunctions } from 'n8n-workflow';
import type { Ros } from 'roslib';

import { RosActionService } from '../shared/services/RosActionService';
import { RosApiService } from '../shared/services/RosApiService';
import type { JsonRecord } from '../shared/services/RosBridgeService';
import { MessageTypeValidator } from '../shared/utils/MessageTypeValidator';
import { ParameterExtractor } from '../shared/utils/ParameterExtractor';
import { ResourceMapperCoercer } from '../shared/utils/ResourceMapperCoercer';

export type RosActionOperation =
    | 'sendGoalAndWait'
    | 'sendGoal'
    | 'getResult'
    | 'cancelGoal'
    | 'watchFeedback'
    | 'watchStatus';

/**
 * Operations that change the state of the robot. Sending a goal drives the
 * action server, and cancelling one interrupts whatever it is doing, so both
 * need a writable credential. Collecting a result and watching the feedback or
 * status topics only observe a goal that is already running.
 */
const WRITE_OPERATIONS = new Set<RosActionOperation>(['sendGoal', 'sendGoalAndWait', 'cancelGoal']);

/** Whether the operation changes the state of the robot. */
export function isWriteOperation(operation: RosActionOperation): boolean {
    return WRITE_OPERATIONS.has(operation);
}

/** Reads a resourceLocator parameter that may also be a plain string. */
function extractLocator(node: IExecuteFunctions, itemIndex: number, name: string): string {
    const locator = node.getNodeParameter(name, itemIndex) as
        | { mode: string; value: string }
        | string;
    return typeof locator === 'string' ? locator : locator?.value ?? '';
}

/**
 * Builds the goal payload from whichever input mode is selected and validates
 * it against the real action goal type. Mismatches abort before anything is
 * sent; if the type cannot be introspected, validation is skipped.
 */
async function buildGoal(
    ros: Ros,
    node: IExecuteFunctions,
    itemIndex: number,
    actionType: string,
): Promise<JsonRecord> {
    const goalInputMode = node.getNodeParameter('goalInputMode', itemIndex) as 'fixed' | 'raw';

    let goal: JsonRecord;
    if (goalInputMode === 'fixed') {
        goal = ResourceMapperCoercer.coerceMessage(
            node.getNodeParameter('goalStructure', itemIndex),
            node,
            itemIndex,
        );
    } else {
        goal = ParameterExtractor.parseJsonParameter(
            node.getNodeParameter('goalJson', itemIndex) as string,
            'goalJson',
            node,
            itemIndex,
        );
    }

    if (!actionType) {
        return goal;
    }

    return MessageTypeValidator.validateAgainstType(goal, node, itemIndex, async () =>
        RosApiService.expandRootTypeDef(
            actionType,
            await RosApiService.getActionGoalDetails(ros, actionType),
        ),
    );
}

/**
 * Dispatches one action operation and returns the JSON payload for the node
 * output.
 */
export async function runOperation(
    operation: RosActionOperation,
    ros: Ros,
    node: IExecuteFunctions,
    itemIndex: number,
): Promise<IDataObject> {
    switch (operation) {
        case 'sendGoalAndWait': {
            const serverName = extractLocator(node, itemIndex, 'serverName');
            const actionType = extractLocator(node, itemIndex, 'actionType');
            const includeFeedback = node.getNodeParameter('includeFeedback', itemIndex) as boolean;
            const timeoutMs = ParameterExtractor.extractRequiredNumber(node, itemIndex, 'timeoutMs');
            const goal = await buildGoal(ros, node, itemIndex, actionType);

            const outcome = await RosActionService.sendGoalAndWait(
                ros,
                serverName,
                actionType,
                goal,
                timeoutMs,
                includeFeedback,
            );

            return {
                serverName: outcome.serverName,
                actionType: outcome.actionType,
                goalHandle: outcome.handleId,
                status: outcome.status,
                statusCode: outcome.statusCode,
                succeeded: outcome.succeeded,
                result: outcome.result,
                error: outcome.error ?? null,
                ...(includeFeedback ? { feedback: outcome.feedback } : {}),
                finishedAt: new Date().toISOString(),
            };
        }

        case 'sendGoal': {
            const serverName = extractLocator(node, itemIndex, 'serverName');
            const actionType = extractLocator(node, itemIndex, 'actionType');
            const includeFeedback = node.getNodeParameter('includeFeedback', itemIndex) as boolean;
            const goal = await buildGoal(ros, node, itemIndex, actionType);

            const handle = RosActionService.sendGoal(
                ros,
                serverName,
                actionType,
                goal,
                includeFeedback,
            );

            return {
                serverName: handle.serverName,
                actionType: handle.actionType,
                goalHandle: handle.handleId,
                sentAt: new Date().toISOString(),
            };
        }

        case 'getResult': {
            const goalHandle = ParameterExtractor.extractRequiredString(node, itemIndex, 'goalHandle');
            const timeoutMs = ParameterExtractor.extractRequiredNumber(node, itemIndex, 'timeoutMs');
            const outcome = await RosActionService.awaitOutcome(goalHandle, timeoutMs);

            return {
                serverName: outcome.serverName,
                actionType: outcome.actionType,
                goalHandle: outcome.handleId,
                status: outcome.status,
                statusCode: outcome.statusCode,
                succeeded: outcome.succeeded,
                result: outcome.result,
                error: outcome.error ?? null,
                feedback: outcome.feedback,
                finishedAt: new Date().toISOString(),
            };
        }

        case 'cancelGoal': {
            const goalHandle = ParameterExtractor.extractRequiredString(node, itemIndex, 'goalHandle');
            const handle = RosActionService.cancelGoal(goalHandle);

            return {
                serverName: handle.serverName,
                actionType: handle.actionType,
                goalHandle: handle.handleId,
                cancelRequestedAt: new Date().toISOString(),
            };
        }

        case 'watchFeedback': {
            const serverName = extractLocator(node, itemIndex, 'serverName');
            const actionType = extractLocator(node, itemIndex, 'actionType');
            const goalId = ParameterExtractor.extractOptionalString(node, itemIndex, 'goalId');
            const timeoutMs = ParameterExtractor.extractRequiredNumber(
                node,
                itemIndex,
                'watchTimeoutMs',
            );

            const { goalId: messageGoalId, feedback } = await RosActionService.waitForFeedback(
                ros,
                serverName,
                actionType,
                timeoutMs,
                goalId || undefined,
            );

            return {
                serverName,
                actionType,
                goalId: messageGoalId,
                feedback,
                receivedAt: new Date().toISOString(),
            };
        }

        case 'watchStatus': {
            const serverName = extractLocator(node, itemIndex, 'serverName');
            const goalId = ParameterExtractor.extractOptionalString(node, itemIndex, 'goalId');
            const timeoutMs = ParameterExtractor.extractRequiredNumber(
                node,
                itemIndex,
                'watchTimeoutMs',
            );

            const { goals, raw } = await RosActionService.waitForStatus(
                ros,
                serverName,
                timeoutMs,
                goalId || undefined,
            );

            return {
                serverName,
                goals,
                rawStatusMessage: raw,
                checkedAt: new Date().toISOString(),
            };
        }

        default: {
            const unsupported: never = operation;
            throw new Error(`Unsupported action operation: ${String(unsupported)}`);
        }
    }
}
