import type { INode } from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { assertWriteAllowed, isReadOnlyCredential } from '../utils/ReadOnlyGuard';

const context = {
    getNode: () => ({ name: 'ROS2 Topic Publish', type: 'rosTopicPublish' }) as unknown as INode,
};

describe('isReadOnlyCredential', () => {
    it('treats a missing flag as writable, so credentials stored before the switch existed keep working', () => {
        expect(isReadOnlyCredential({ host: 'localhost' })).toBe(false);
        expect(isReadOnlyCredential({})).toBe(false);
    });

    it('reports read-only for the boolean flag', () => {
        expect(isReadOnlyCredential({ readOnly: true })).toBe(true);
        expect(isReadOnlyCredential({ readOnly: false })).toBe(false);
    });

    it('accepts the string form an expression can produce', () => {
        expect(isReadOnlyCredential({ readOnly: 'true' })).toBe(true);
        expect(isReadOnlyCredential({ readOnly: 'false' })).toBe(false);
    });

    it('does not fall over on missing or non-object credentials', () => {
        expect(isReadOnlyCredential(undefined)).toBe(false);
        expect(isReadOnlyCredential(null)).toBe(false);
        expect(isReadOnlyCredential('readOnly')).toBe(false);
    });
});

describe('assertWriteAllowed', () => {
    it('passes through when the credential is not read-only', () => {
        expect(() => assertWriteAllowed(context, { readOnly: false }, 'Publishing to "/cmd_vel"')).not.toThrow();
    });

    it('throws a node error naming the refused action', () => {
        expect(() =>
            assertWriteAllowed(context, { readOnly: true }, 'Publishing to topic "/cmd_vel"'),
        ).toThrow(NodeOperationError);

        expect(() =>
            assertWriteAllowed(context, { readOnly: true }, 'Publishing to topic "/cmd_vel"'),
        ).toThrow(/Publishing to topic "\/cmd_vel" is blocked/);
    });

    it('keeps the item index on the error so the failing item is reported', () => {
        try {
            assertWriteAllowed(context, { readOnly: true }, 'Calling service "/reset"', 3);
            throw new Error('expected assertWriteAllowed to throw');
        } catch (error) {
            expect((error as NodeOperationError).context.itemIndex).toBe(3);
        }
    });
});
