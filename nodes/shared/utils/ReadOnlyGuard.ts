/**
 * Read-only enforcement for credentials.
 *
 * Both the rosbridge and the Docker credential carry a "Read-Only" switch.
 * When it is on, the credential may only be used to observe: subscribing to
 * topics, listing the graph, resolving types and definitions, reading logs.
 * Everything that changes state on the robot - publishing, calling a service,
 * starting or cancelling a goal, advertising a server, setting a parameter,
 * starting/stopping a container - has to call assertWriteAllowed() before it
 * touches the connection.
 *
 * The switch lives on the credential (and not on the node) so that a workflow
 * author cannot lift it, and neither can an AI agent driving the node as a
 * tool: agents only fill parameters, they never pick credentials.
 */

import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/** Shape shared by every credential that carries the read-only switch. */
export interface ReadOnlyCapableCredentials {
    readOnly?: boolean;
}

/** The bit of the node context the guard needs; kept minimal so execute, trigger and loadOptions contexts all fit. */
interface NodeContext {
    getNode(): INode;
}

/**
 * Whether the credential forbids write operations. Credentials stored before
 * the switch existed have no `readOnly` field at all and stay writable; a
 * string "true" is accepted because expression-provided values arrive as text.
 */
export function isReadOnlyCredential(credentials: unknown): boolean {
    if (credentials === null || typeof credentials !== 'object') {
        return false;
    }
    const value = (credentials as { readOnly?: unknown }).readOnly;
    return value === true || value === 'true';
}

/**
 * Aborts a write operation when the credential is read-only. `action`
 * describes the attempt in the first person of the node, e.g.
 * `Publishing to "/cmd_vel"`; it is used verbatim in the error message so an
 * agent reading it as a tool observation knows what was refused.
 */
export function assertWriteAllowed(
    context: NodeContext,
    credentials: unknown,
    action: string,
    itemIndex = 0,
): void {
    if (!isReadOnlyCredential(credentials)) {
        return;
    }

    throw new NodeOperationError(
        context.getNode(),
        `${action} is blocked: the credential used by this node is set to read-only`,
        {
            itemIndex,
            description:
                'Read-only credentials may only observe the system. Listening to topics and listing topics, services, actions, nodes and their types or definitions still work. To allow this operation, turn off "Read-Only" on the credential or select a credential that has it turned off.',
        },
    );
}
