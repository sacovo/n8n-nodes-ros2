/**
 * Unit tests for the shared programmatic credential test functions.
 * The network layers (RosBridgeService / dockerode) are mocked so the tests
 * exercise only the OK / Error mapping logic.
 */

import type {
    ICredentialsDecrypted,
    ICredentialTestFunctions,
} from 'n8n-workflow';

import { rosBridgeApiTest, dockerApiTest } from '../utils/CredentialTests';
import { RosBridgeService } from '../services/RosBridgeService';

jest.mock('../services/RosBridgeService');
jest.mock('dockerode');

import Docker from 'dockerode';

const mockedRosBridgeService = RosBridgeService as jest.Mocked<typeof RosBridgeService>;
const MockedDocker = Docker as unknown as jest.Mock;

// The test functions never touch `this`, so an empty stub is sufficient.
const testFunctionsContext = {} as ICredentialTestFunctions;

function buildCredential(data: Record<string, unknown>): ICredentialsDecrypted {
    return {
        id: '1',
        name: 'test',
        type: 'rosBridgeApi',
        data,
    } as unknown as ICredentialsDecrypted;
}

describe('rosBridgeApiTest', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns OK when the connection succeeds', async () => {
        mockedRosBridgeService.connect.mockResolvedValue({} as never);

        const credential = buildCredential({
            protocol: 'ws',
            host: 'localhost',
            port: 9090,
            connectTimeoutMs: 3000,
        });

        const result = await rosBridgeApiTest.call(testFunctionsContext, credential);

        expect(result.status).toBe('OK');
        expect(mockedRosBridgeService.connect).toHaveBeenCalledWith(
            expect.objectContaining({
                protocol: 'ws',
                host: 'localhost',
                port: 9090,
                connectTimeoutMs: 3000,
            }),
        );
    });

    it('defaults connectTimeoutMs to 5000 when not provided', async () => {
        mockedRosBridgeService.connect.mockResolvedValue({} as never);

        const credential = buildCredential({
            host: 'localhost',
            port: 9090,
        });

        await rosBridgeApiTest.call(testFunctionsContext, credential);

        expect(mockedRosBridgeService.connect).toHaveBeenCalledWith(
            expect.objectContaining({ connectTimeoutMs: 5000 }),
        );
    });

    it('returns Error with the failure message when the connection fails', async () => {
        mockedRosBridgeService.connect.mockRejectedValue(new Error('boom'));

        const credential = buildCredential({
            host: 'localhost',
            port: 9090,
        });

        const result = await rosBridgeApiTest.call(testFunctionsContext, credential);

        expect(result.status).toBe('Error');
        expect(result.message).toContain('boom');
    });
});

describe('dockerApiTest', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('returns OK when ping succeeds', async () => {
        const ping = jest.fn().mockResolvedValue(Buffer.from('OK'));
        MockedDocker.mockImplementation(() => ({ ping }));

        const credential = buildCredential({
            connectionType: 'socket',
            socketPath: '/var/run/docker.sock',
        });

        const result = await dockerApiTest.call(testFunctionsContext, credential);

        expect(result.status).toBe('OK');
        expect(ping).toHaveBeenCalled();
        expect(MockedDocker).toHaveBeenCalledWith(
            expect.objectContaining({ socketPath: '/var/run/docker.sock' }),
        );
    });

    it('returns Error when ping fails', async () => {
        const ping = jest.fn().mockRejectedValue(new Error('no daemon'));
        MockedDocker.mockImplementation(() => ({ ping }));

        const credential = buildCredential({
            connectionType: 'http',
            protocol: 'http',
            host: 'localhost',
            port: 2375,
        });

        const result = await dockerApiTest.call(testFunctionsContext, credential);

        expect(result.status).toBe('Error');
        expect(result.message).toContain('no daemon');
    });
});
