/**
 * Unit tests for MessageFilter — including backward compatibility with
 * conditions stored by workflows exported before the filter was evaluated
 * (left values saved as n8n expressions like `={{ $json.message.data }}`).
 */

import { checkFilter, normalizeFilterConditions, type FilterData } from '../utils/MessageFilter';

function filterWith(conditions: FilterData['conditions'], caseSensitive = true): FilterData {
    return {
        options: { caseSensitive },
        combinator: 'and',
        conditions,
    };
}

describe('normalizeFilterConditions', () => {
    it('converts legacy expression left values to plain message paths', () => {
        const normalized = normalizeFilterConditions(
            filterWith([
                {
                    leftValue: '={{ $json.message.data }}',
                    rightValue: 3,
                    operator: { type: 'number', operation: 'equals' },
                },
            ]),
        );

        expect(normalized.conditions[0].leftValue).toBe('data');
        expect(normalized.conditions[0].rightValue).toBe(3);
    });

    it('handles expressions without the leading equals sign and nested paths', () => {
        const normalized = normalizeFilterConditions(
            filterWith([
                {
                    leftValue: '{{ $json.message.pose.position.x }}',
                    rightValue: '1',
                    operator: { type: 'number', operation: 'gt' },
                },
            ]),
        );

        expect(normalized.conditions[0].leftValue).toBe('pose.position.x');
    });

    it('leaves plain field paths and empty values untouched', () => {
        const normalized = normalizeFilterConditions(
            filterWith([
                { leftValue: 'data', rightValue: 'x', operator: { type: 'string', operation: 'equals' } },
                { leftValue: '', rightValue: '', operator: { type: 'string', operation: 'equals' } },
            ]),
        );

        expect(normalized.conditions[0].leftValue).toBe('data');
        expect(normalized.conditions[1].leftValue).toBe('');
    });

    it('resolves expression right values through the evaluator', () => {
        const normalized = normalizeFilterConditions(
            filterWith([
                {
                    leftValue: 'data',
                    rightValue: '={{ $json.threshold }}',
                    operator: { type: 'number', operation: 'equals' },
                },
            ]),
            () => 42,
        );

        expect(normalized.conditions[0].rightValue).toBe(42);
    });

    it('turns expression right values into null when evaluation fails or no evaluator exists', () => {
        const failing = normalizeFilterConditions(
            filterWith([
                { leftValue: 'data', rightValue: '={{ $json.x }}', operator: { type: 'string', operation: 'equals' } },
            ]),
            () => {
                throw new Error('boom');
            },
        );
        const withoutEvaluator = normalizeFilterConditions(
            filterWith([
                { leftValue: 'data', rightValue: '={{ $json.x }}', operator: { type: 'string', operation: 'equals' } },
            ]),
        );

        expect(failing.conditions[0].rightValue).toBeNull();
        expect(withoutEvaluator.conditions[0].rightValue).toBeNull();
    });

    it('passes empty filters through unchanged', () => {
        const empty = {} as FilterData;
        expect(normalizeFilterConditions(empty)).toBe(empty);
    });
});

describe('checkFilter with normalized legacy conditions (Deep Sampling regression)', () => {
    // Shaped exactly like the conditions stored in real workflow exports
    // created while the Conditions UI existed but was never evaluated.
    const legacyWaitForValue = filterWith([
        {
            leftValue: '={{ $json.message.data }}',
            rightValue: 3,
            operator: { type: 'number', operation: 'equals' },
        },
    ]);

    it('waits for the intended message value', () => {
        const normalized = normalizeFilterConditions(legacyWaitForValue);

        expect(checkFilter({ json: { message: { data: 3 } } }, normalized)).toBe(true);
        expect(checkFilter({ json: { message: { data: 2 } } }, normalized)).toBe(false);
    });

    it('lets empty leftover condition rows pass every message', () => {
        const emptyRow = normalizeFilterConditions(
            filterWith([{ leftValue: '', rightValue: '', operator: { type: 'string', operation: 'equals' } }]),
        );

        expect(checkFilter({ json: { message: { data: 1 } } }, emptyRow)).toBe(true);
    });
});
