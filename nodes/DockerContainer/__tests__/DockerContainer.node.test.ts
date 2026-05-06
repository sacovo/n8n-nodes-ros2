import { DockerContainer } from '../DockerContainer.node';
import type { IExecuteFunctions, ILoadOptionsFunctions, INodeType, IDataObject } from 'n8n-workflow';

// Mock the dockerode module
jest.mock('dockerode', () => {
    return jest.fn().mockImplementation((options) => {
        return {
            options, // store options for verification in tests if needed
            getContainer: jest.fn().mockReturnValue({
                start: jest.fn().mockResolvedValue({}),
                stop: jest.fn().mockResolvedValue({}),
                restart: jest.fn().mockResolvedValue({}),
            }),
            listContainers: jest.fn().mockResolvedValue([
                { Id: '123', Names: ['/container1'], Status: 'Up', Image: 'nginx', State: 'running' },
                { Id: '456', Names: ['/container2'], Status: 'Exited', Image: 'ubuntu', State: 'exited' },
            ]),
        };
    });
});

describe('DockerContainer Node', () => {
    let node: DockerContainer;
    let mockExecuteFunctions: jest.Mocked<IExecuteFunctions>;

    beforeEach(() => {
        jest.clearAllMocks();
        node = new DockerContainer();
        mockExecuteFunctions = {
            getInputData: jest.fn(),
            getNodeParameter: jest.fn(),
            continueOnFail: jest.fn().mockReturnValue(false),
            getNode: jest.fn().mockReturnValue({ name: 'dockerContainer' } as unknown as INodeType),
            getCredentials: jest.fn(),
        } as unknown as jest.Mocked<IExecuteFunctions>;
    });

    it('should be correctly initialized', () => {
        expect(node.description.name).toBe('dockerContainer');
        expect(node.description.displayName).toBe('Docker Container');
        expect(node.description.credentials).toContainEqual({ name: 'dockerApi', required: true, testedBy: 'dockerApi' });
    });

    it('should handle start operation with socket', async () => {
        mockExecuteFunctions.getInputData.mockReturnValue([{ json: {} }]);
        mockExecuteFunctions.getCredentials.mockResolvedValue({
            connectionType: 'socket',
            socketPath: '/var/run/docker.sock',
        });
        mockExecuteFunctions.getNodeParameter.mockImplementation((paramName: string) => {
            if (paramName === 'operation') return 'start';
            if (paramName === 'containerId') return { mode: 'id', value: 'test-container' };
            return undefined;
        });

        const result = await node.execute.call(mockExecuteFunctions);

        expect(result).toBeDefined();
        expect(result[0][0].json).toHaveProperty('success', true);
        expect(result[0][0].json).toHaveProperty('message', 'Container test-container started successfully');
    });

    it('should handle list operation with http', async () => {
        mockExecuteFunctions.getInputData.mockReturnValue([{ json: {} }]);
        mockExecuteFunctions.getCredentials.mockResolvedValue({
            connectionType: 'http',
            protocol: 'http',
            host: 'localhost',
            port: 2375,
            authentication: 'none',
        });
        mockExecuteFunctions.getNodeParameter.mockImplementation((paramName: string) => {
            if (paramName === 'operation') return 'list';
            return undefined;
        });

        const result = await node.execute.call(mockExecuteFunctions);

        expect(result).toBeDefined();
        expect(result[0][0].json).toHaveProperty('success', true);
        const json = result[0][0].json as IDataObject;
        const containers = json.containers as IDataObject[];
        expect(containers).toHaveLength(2);
        expect(containers[0]).toEqual({
            id: '123',
            names: ['container1'],
            image: 'nginx',
            state: 'running',
            status: 'Up',
        });
    });

    describe('listSearch', () => {
        it('should get containers list', async () => {
            const mockLoadOptionsFunctions = {
                getCredentials: jest.fn().mockResolvedValue({
                    connectionType: 'socket',
                    socketPath: '/var/run/docker.sock',
                }),
            } as unknown as ILoadOptionsFunctions;

            const result = await node.methods.listSearch.getContainersList.call(mockLoadOptionsFunctions);

            expect(result).toEqual({
                results: [
                    { name: 'container1', value: '123', description: 'Up | nginx' },
                    { name: 'container2', value: '456', description: 'Exited | ubuntu' },
                ],
            });
        });

        it('should filter containers list', async () => {
            const mockLoadOptionsFunctions = {
                getCredentials: jest.fn().mockResolvedValue({
                    connectionType: 'socket',
                    socketPath: '/var/run/docker.sock',
                }),
            } as unknown as ILoadOptionsFunctions;

            const result = await node.methods.listSearch.getContainersList.call(mockLoadOptionsFunctions, 'container1');

            expect(result.results).toHaveLength(1);
            expect(result.results[0].name).toBe('container1');
        });
    });
});
