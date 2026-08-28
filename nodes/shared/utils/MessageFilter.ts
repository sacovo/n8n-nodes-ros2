/**
 * Evaluation of n8n filter-type parameters against ROS messages.
 *
 * Left values are plain field paths into the message (e.g. "data" or
 * "pose.position.x"), not n8n expressions, because messages arrive after
 * parameter resolution.
 */

import type { INodeExecutionData } from 'n8n-workflow';
import get from 'lodash/get';

type Condition = {
    leftValue: unknown;
    rightValue: unknown;
    operator: {
        operation: string;
        type: string;
    };
};

export type FilterData = {
    options: {
        caseSensitive: boolean;
    };
    conditions: Condition[];
    combinator: string;
};

/**
 * Normalizes a filter value that was read with `rawExpressions: true`.
 *
 * Workflows exported before the Conditions filter was actually evaluated
 * store left values as n8n expressions (e.g. `={{ $json.message.data }}`,
 * built via drag & drop against the node's output). checkFilter expects a
 * plain field path into the arriving message (e.g. `data`), so legacy
 * expressions are converted to the path they reference. Expression right
 * values are resolved through the provided evaluator; without one (or if
 * evaluation fails) they become null so the condition fails instead of
 * crashing the execution.
 */
export function normalizeFilterConditions(
    filter: FilterData,
    evaluateExpression?: (expression: string) => unknown,
): FilterData {
    if (!filter?.conditions?.length) {
        return filter;
    }
    return {
        ...filter,
        conditions: filter.conditions.map((condition) => ({
            ...condition,
            leftValue: normalizeLeftValue(condition.leftValue),
            rightValue: normalizeRightValue(condition.rightValue, evaluateExpression),
        })),
    };
}

function extractExpressionBody(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    const match = value.trim().match(/^=?\s*\{\{([\s\S]*)\}\}$/);
    return match ? match[1].trim() : undefined;
}

function normalizeLeftValue(value: unknown): unknown {
    const expression = extractExpressionBody(value);
    if (expression === undefined) {
        return value;
    }
    let path = expression;
    if (path.startsWith('$json')) {
        path = path.slice('$json'.length).replace(/^\./, '');
    }
    // The node output wraps the ROS message as `message`, but checkFilter
    // already resolves paths within the message itself.
    if (path === 'message') {
        path = '';
    } else if (path.startsWith('message.')) {
        path = path.slice('message.'.length);
    } else if (path.startsWith("['message']")) {
        path = path.slice("['message']".length).replace(/^\./, '');
    }
    return path;
}

function normalizeRightValue(value: unknown, evaluateExpression?: (expression: string) => unknown): unknown {
    const expression = extractExpressionBody(value);
    if (expression === undefined) {
        return value;
    }
    if (!evaluateExpression) {
        return null;
    }
    try {
        return evaluateExpression(`{{ ${expression} }}`);
    } catch {
        return null;
    }
}

export function checkFilter(item: INodeExecutionData, filterData: FilterData): boolean {
    if (!filterData?.conditions?.length) {
        return true;
    }
    const { conditions: conds, combinator } = filterData;

    const pass = conds.map((c) => {
        if (c.leftValue === null && c.rightValue === null) {
            return true; // Both null means condition is empty
        }
        let leftValue = c.leftValue;
        if (typeof leftValue === 'string') {
            leftValue = get(item.json['message'], leftValue);
        }

        const rightValue = c.rightValue;
        const op = c.operator.operation;
        const type = c.operator.type;

        if (op === 'exists') return leftValue !== undefined && leftValue !== null;
        if (op === 'notExists') return leftValue === undefined || leftValue === null;

        if (type === 'string') {
            const left = String(leftValue || '');
            const right = String(rightValue || '');
            const ignoreCase = !filterData.options.caseSensitive;
            const l = ignoreCase ? left.toLowerCase() : left;
            const r = ignoreCase ? right.toLowerCase() : right;

            if (op === 'equals') return l === r;
            if (op === 'notEquals') return l !== r;
            if (op === 'contains') return l.includes(r);
            if (op === 'notContains') return !l.includes(r);
            if (op === 'startsWith') return l.startsWith(r);
            if (op === 'endsWith') return l.endsWith(r);

            // String length operations
            const rVal = Number(rightValue);
            if (op === 'lengthEquals') return left.length === rVal;
            if (op === 'lengthNotEquals') return left.length !== rVal;
            if (op === 'lengthGt') return left.length > rVal;
            if (op === 'lengthLt') return left.length < rVal;
            if (op === 'lengthGte') return left.length >= rVal;
            if (op === 'lengthLte') return left.length <= rVal;
        }

        if (type === 'number') {
            const left = Number(leftValue);
            const right = Number(rightValue);
            if (op === 'equals') return left === right;
            if (op === 'gt') return left > right;
            if (op === 'lt') return left < right;
            if (op === 'gte') return left >= right;
            if (op === 'lte') return left <= right;
        }

        if (type === 'array') {
            const left = Array.isArray(leftValue) ? leftValue : [];
            const rVal = Number(rightValue);
            if (op === 'lengthEquals') return left.length === rVal;
            if (op === 'lengthNotEquals') return left.length !== rVal;
            if (op === 'lengthGt') return left.length > rVal;
            if (op === 'lengthLt') return left.length < rVal;
            if (op === 'lengthGte') return left.length >= rVal;
            if (op === 'lengthLte') return left.length <= rVal;
        }

        if (type === 'boolean') {
            const left = Boolean(leftValue);
            if (op === 'true') return left === true;
            if (op === 'false') return left === false;
            if (op === 'equals') return left === Boolean(rightValue);
        }

        return false;
    });

    return combinator === 'or' ? pass.some(Boolean) : pass.every(Boolean);
}
