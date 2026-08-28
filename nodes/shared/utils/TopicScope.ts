/**
 * Namespace scoping for write operations on ROS names.
 *
 * A node can be restricted to a set of namespace prefixes so that it only
 * ever writes below them (e.g. "/mani"). This matters mainly when a node is
 * attached to an AI agent: the agent picks the topic name, but it cannot
 * change the scope, because agents only fill parameters the workflow author
 * opened up with `$fromAI`.
 */

import type { IExecuteFunctions } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/**
 * Brings a ROS name into a comparable form: relative names get a leading
 * slash, repeated and trailing slashes are dropped ("mani/cmd_vel/" ->
 * "/mani/cmd_vel"). Returns an empty string for anything blank.
 */
export function normalizeRosName(name: unknown): string {
    if (typeof name !== 'string') {
        return '';
    }
    const segments = name
        .trim()
        .split('/')
        .filter((segment) => segment !== '');
    return segments.length === 0 ? '' : `/${segments.join('/')}`;
}

/**
 * Parses the user-entered scope (comma- or newline-separated prefixes) into
 * normalized prefixes. An empty result means "unrestricted".
 */
export function parseTopicScope(raw: unknown): string[] {
    if (typeof raw !== 'string') {
        return [];
    }
    const prefixes = raw
        .split(/[,\n]/)
        .map((prefix) => normalizeRosName(prefix))
        .filter((prefix) => prefix !== '');
    return [...new Set(prefixes)];
}

/**
 * Matches a name against a single prefix on segment boundaries, so "/mani"
 * covers "/mani" and "/mani/cmd_vel" but not "/manipulator/cmd_vel". A "*"
 * segment in the prefix matches exactly one segment of the name, which
 * allows patterns like "/robot/[any]/cmd_vel".
 */
function matchesPrefix(name: string, prefix: string): boolean {
    const nameSegments = name.split('/');
    const prefixSegments = prefix.split('/');

    if (nameSegments.length < prefixSegments.length) {
        return false;
    }

    return prefixSegments.every((segment, index) => segment === '*' || segment === nameSegments[index]);
}

/**
 * Whether a name is covered by the scope. An empty scope allows everything,
 * which keeps nodes without a configured scope behaving as before.
 */
export function isInScope(name: unknown, scope: string[]): boolean {
    if (scope.length === 0) {
        return true;
    }
    const normalized = normalizeRosName(name);
    if (normalized === '') {
        return false;
    }
    return scope.some((prefix) => matchesPrefix(normalized, prefix));
}

/**
 * Keeps only the names covered by the scope. Used to hide out-of-scope
 * topics from the picker; the actual gate is assertInScope in execute().
 */
export function filterByScope(names: string[], scope: string[]): string[] {
    if (scope.length === 0) {
        return names;
    }
    return names.filter((name) => isInScope(name, scope));
}

/**
 * Aborts the operation when the name lies outside the scope. The message
 * names both the attempted topic and the allowed prefixes so that an agent
 * reading it as a tool observation can retry with an allowed name.
 */
export function assertInScope(
    executeFunctions: IExecuteFunctions,
    name: unknown,
    scope: string[],
    itemIndex: number,
): void {
    if (isInScope(name, scope)) {
        return;
    }

    const attempted = normalizeRosName(name) || String(name ?? '');
    throw new NodeOperationError(
        executeFunctions.getNode(),
        `Topic "${attempted}" is outside the namespaces this node may publish to (${scope.join(', ')})`,
        {
            itemIndex,
            description: 'Pick a topic inside an allowed namespace, or widen "Allowed Namespaces" in the node options.',
        },
    );
}
