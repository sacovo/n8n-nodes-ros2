import type {
    ICredentialsDecrypted,
    ICredentialTestFunctions,
    IDataObject,
    INodeCredentialTestResult,
} from 'n8n-workflow';
import Docker from 'dockerode';

import { RosBridgeService, type RosBridgeCredentials } from '../services/RosBridgeService';

/**
 * Shared programmatic credential test functions.
 *
 * n8n resolves a credential's "Test" button by finding a node type that both
 * references the credential via `testedBy` AND exposes a matching
 * `methods.credentialTest` entry. Because our credentials connect over a
 * WebSocket (rosbridge) or a unix socket / HTTP (Docker), the declarative
 * HTTP-request test is not usable — these functions perform a real connection
 * attempt instead. Every node that declares `testedBy` registers the matching
 * function here so the single implementation is shared.
 */

/**
 * Tests a rosbridge credential by opening a WebSocket connection through
 * RosBridgeService. Connections are pooled, so a successful test deliberately
 * leaves its socket open for the next execution to reuse.
 */
export async function rosBridgeApiTest(
    this: ICredentialTestFunctions,
    credential: ICredentialsDecrypted,
): Promise<INodeCredentialTestResult> {
    const data = (credential.data ?? {}) as IDataObject;

    const credentials: RosBridgeCredentials = {
        protocol: (data.protocol as 'ws' | 'wss') || 'ws',
        host: data.host as string,
        port: data.port as number,
        path: data.path as string | undefined,
        authToken: data.authToken as string | undefined,
        authQueryParameter: data.authQueryParameter as string | undefined,
        connectTimeoutMs: (data.connectTimeoutMs as number) || 5000,
    };

    try {
        await RosBridgeService.connect(credentials);
        return {
            status: 'OK',
            message: 'Connection to rosbridge established successfully',
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            status: 'Error',
            message: `Could not connect to rosbridge: ${message}`,
        };
    }
}

/**
 * Tests a Docker credential by building a dockerode instance the same way the
 * DockerContainer node does (socket vs http + optional basic auth) and calling
 * the cheap `ping()` endpoint.
 */
export async function dockerApiTest(
    this: ICredentialTestFunctions,
    credential: ICredentialsDecrypted,
): Promise<INodeCredentialTestResult> {
    const data = (credential.data ?? {}) as IDataObject;

    const options: Docker.DockerOptions = {};

    if (data.connectionType === 'socket') {
        options.socketPath = data.socketPath as string;
    } else {
        options.protocol = data.protocol as 'http' | 'https';
        options.host = data.host as string;
        options.port = data.port as number;

        if (data.authentication === 'basicAuth') {
            const token = Buffer.from(`${data.username}:${data.password}`).toString('base64');
            options.headers = {
                Authorization: `Basic ${token}`,
            };
        }
    }
    options.timeout = 10000;

    try {
        const docker = new Docker(options);
        await docker.ping();
        return {
            status: 'OK',
            message: 'Connection to Docker established successfully',
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
            status: 'Error',
            message: `Could not connect to Docker: ${message}`,
        };
    }
}
