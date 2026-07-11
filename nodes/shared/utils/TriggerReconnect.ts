/**
 * Reconnection support for trigger nodes.
 *
 * A trigger's rosbridge subscription dies silently when the websocket drops
 * (rover reboot, flaky network, rosbridge restart). This helper re-establishes
 * the connection and re-installs the subscription until the trigger is closed.
 */

import type { Ros } from 'roslib';
import { RosBridgeService, type RosBridgeCredentials } from '../services/RosBridgeService';

export type TriggerTeardown = () => void | Promise<void>;

/**
 * Connects to rosbridge and runs `setup` to install a subscription.
 * The initial connection failure is thrown so workflow activation fails
 * visibly; afterwards, a closed websocket schedules reconnect attempts every
 * `retryDelayMs` until the returned stop function is called.
 */
export async function connectWithReconnect(
    credentials: RosBridgeCredentials,
    setup: (ros: Ros) => Promise<TriggerTeardown>,
    retryDelayMs = 5000,
): Promise<() => Promise<void>> {
    let stopped = false;
    let teardown: TriggerTeardown | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const scheduleReconnect = () => {
        if (stopped) {
            return;
        }
        teardown = undefined;
        retryTimer = setTimeout(() => {
            void attach().catch(scheduleReconnect);
        }, retryDelayMs);
    };

    const attach = async () => {
        const ros = await RosBridgeService.connect(credentials);
        teardown = await setup(ros);
        ros.once('close', scheduleReconnect);
    };

    await attach();

    return async () => {
        stopped = true;
        if (retryTimer) {
            clearTimeout(retryTimer);
        }
        if (teardown) {
            await teardown();
        }
    };
}
