import type { INode } from 'n8n-workflow';

/**
 * The minimal slice of an n8n node context needed to raise a node-scoped
 * error. Execute, trigger and load-options contexts all satisfy it, so helpers
 * that only report errors can accept any of them without a cast.
 */
export interface NodeContext {
    getNode(): INode;
}
