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
    leftValue: null | string;
    rightValue: null | string;
    operator: {
        operation: string;
        type: string;
    };
};

export type FilterData = {
    options: {
        caseSensitive: boolean;
    },
    conditions: Condition[];
    combinator: string;
};

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
            leftValue = get(item.json["message"], leftValue);
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
