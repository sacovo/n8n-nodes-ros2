import type {
    IDataObject,
    IExecuteFunctions,
    INodeExecutionData,
    INodeType,
    INodeTypeDescription,
    JsonObject,
    ILoadOptionsFunctions,
    INodeListSearchResult,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes } from 'n8n-workflow';
import Docker from 'dockerode';

import { dockerApiTest } from '../shared/utils/CredentialTests';
import { NodeErrorHandler } from '../shared/utils/NodeErrorHandler';

function getDockerInstance(credentials: IDataObject): Docker {
    const options: Docker.DockerOptions = {};

    if (credentials.connectionType === 'socket') {
        options.socketPath = credentials.socketPath as string;
    } else {
        options.protocol = credentials.protocol as 'http' | 'https';
        options.host = credentials.host as string;
        options.port = credentials.port as number;

        if (credentials.authentication === 'basicAuth') {
            const token = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64');
            options.headers = {
                Authorization: `Basic ${token}`,
            };
        }
    }
    options.timeout = 10000;

    return new Docker(options);
}

export class DockerContainer implements INodeType {
    description: INodeTypeDescription = {
        displayName: 'Docker Container',
        name: 'dockerContainer',
        icon: 'file:docker.svg',
        group: ['transform'],
        version: 1,
        description: 'Control Docker containers',
        subtitle: '={{$parameter["operation"]}}',
        defaults: {
            name: 'Docker Container',
        },
        usableAsTool: {
            replacements: {
                description: 'Manage Docker containers via the Docker API: list containers, start/stop/restart them, fetch logs, and exec commands inside a running container. Use this to inspect or control containerized processes (e.g. restarting a stuck ROS2 node\'s container, or checking its logs for errors).',
            },
        },
        inputs: [NodeConnectionTypes.Main],
        outputs: [NodeConnectionTypes.Main],
        credentials: [
            {
                name: 'dockerApi',
                required: true,
                testedBy: 'dockerApi',
            },
        ],
        properties: [
            {
                displayName: 'Resource',
                name: 'resource',
                type: 'options',
                noDataExpression: true,
                options: [
                    {
                        name: 'Container',
                        value: 'container',
                    },
                ],
                default: 'container',
            },
            {
                displayName: 'Operation',
                name: 'operation',
                type: 'options',
                noDataExpression: true,
                displayOptions: {
                    show: {
                        resource: ['container'],
                    },
                },
                options: [
                    {
                        name: 'Execute Command',
                        value: 'exec',
                        description: 'Execute a command in a running container',
                        action: 'Execute a command in a container',
                    },
                    {
                        name: 'Get Logs',
                        value: 'logs',
                        description: 'Get logs from a container',
                        action: 'Get logs from a container',
                    },
                    {
                        name: 'List',
                        value: 'list',
                        description: 'List Docker containers',
                        action: 'List containers',
                    },
                    {
                        name: 'Restart',
                        value: 'restart',
                        description: 'Restart a container',
                        action: 'Restart a container',
                    },
                    {
                        name: 'Start',
                        value: 'start',
                        description: 'Start a container',
                        action: 'Start a container',
                    },
                    {
                        name: 'Stop',
                        value: 'stop',
                        description: 'Stop a container',
                        action: 'Stop a container',
                    },
                ],
                default: 'start',
            },
            {
                displayName: 'Container',
                name: 'containerId',
                type: 'resourceLocator',
                default: { mode: 'list', value: '' },
                required: true,
                displayOptions: {
                    show: {
                        resource: ['container'],
                        operation: ['exec', 'logs', 'restart', 'start', 'stop'],
                    },
                },
                description: 'The Docker container to operate on',
                modes: [
                    {
                        displayName: 'From List',
                        name: 'list',
                        type: 'list',
                        typeOptions: {
                            searchListMethod: 'getContainersList',
                            searchable: true,
                        },
                    },
                    {
                        displayName: 'ID / Name',
                        name: 'id',
                        type: 'string',
                        placeholder: 'e.g. my-container, 1234567890ab',
                    },
                ],
            },
            {
                displayName: 'Lines',
                name: 'lines',
                type: 'number',
                displayOptions: {
                    show: {
                        operation: ['logs'],
                    },
                },
                default: 100,
                description: 'Number of lines to return from the end of the logs',
            },
            {
                displayName: 'Command',
                name: 'command',
                type: 'string',
                displayOptions: {
                    show: {
                        operation: ['exec'],
                    },
                },
                default: '',
                description: 'The command to execute (e.g. ls -la)',
                required: true,
            },
        ],
    };

    methods = {
        credentialTest: {
            dockerApi: dockerApiTest,
        },
        listSearch: {
            async getContainersList(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
                try {
                    const credentials = await this.getCredentials('dockerApi');
                    const docker = getDockerInstance(credentials);
                    const containers = await docker.listContainers({ all: true });

                    let results = containers.map(container => ({
                        name: container.Names[0].replace(/^\//, '') || container.Id,
                        value: container.Id,
                        description: `${container.Status} | ${container.Image}`,
                    }));

                    if (filter) {
                        results = results.filter(r =>
                            r.name.toLowerCase().includes(filter.toLowerCase()) ||
                            r.value.toLowerCase().includes(filter.toLowerCase())
                        );
                    }

                    return { results };
                } catch {
                    return { results: [] };
                }
            },
        },
    };

    async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
        const items = this.getInputData();
        const returnData: INodeExecutionData[] = [];
        const credentials = await this.getCredentials('dockerApi');
        const docker = getDockerInstance(credentials);

        for (let i = 0; i < items.length; i++) {
            try {
                const operation = this.getNodeParameter('operation', i) as string;
                const result: IDataObject = { success: true };

                if (operation === 'list') {
                    const containers = await docker.listContainers({ all: true });
                    result.containers = containers.map(c => ({
                        id: c.Id,
                        names: c.Names.map(n => n.replace(/^\//, '')),
                        image: c.Image,
                        state: c.State,
                        status: c.Status,
                    }));
                } else {
                    const containerIdLocator = this.getNodeParameter('containerId', i) as { mode: string; value: string } | string;
                    const containerId = typeof containerIdLocator === 'string' ? containerIdLocator : containerIdLocator.value;

                    const container = docker.getContainer(containerId);

                    if (operation === 'start') {
                        await container.start();
                        result.message = `Container ${containerId} started successfully`;
                    } else if (operation === 'stop') {
                        await container.stop();
                        result.message = `Container ${containerId} stopped successfully`;
                    } else if (operation === 'restart') {
                        await container.restart();
                        result.message = `Container ${containerId} restarted successfully`;
                    } else if (operation === 'logs') {
                        const lines = this.getNodeParameter('lines', i) as number;
                        const logStream = await container.logs({
                            stdout: true,
                            stderr: true,
                            tail: lines,
                        });

                        // The logstream from dockerode is a buffer, we need to extract the string
                        result.logs = logStream.toString('utf8');
                    } else if (operation === 'exec') {
                        const commandStr = this.getNodeParameter('command', i) as string;
                        // very basic command splitting
                        const cmdArray = commandStr.match(/(?:[^\s"']+|['"][^'"]*["'])+/g)?.map(arg => {
                            if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
                                return arg.slice(1, -1);
                            }
                            return arg;
                        }) || [];

                        const execInstance = await container.exec({
                            Cmd: cmdArray,
                            AttachStdout: true,
                            AttachStderr: true,
                        });

                        const stream = await execInstance.start({ hijack: true, stdin: false });

                        result.output = await new Promise((resolve, reject) => {
                            let output = '';
                            stream.on('data', (chunk) => {
                                if (chunk.length > 8) {
                                    output += chunk.slice(8).toString('utf8');
                                }
                            });
                            stream.on('end', () => resolve(output));
                            stream.on('error', reject);
                        });
                    }
                }

                returnData.push({
                    json: result,
                    pairedItem: { item: i },
                });
            } catch (error) {
                if (NodeErrorHandler.shouldReturnErrorOutput(this)) {
                    returnData.push({
                        json: { error: error.message },
                        pairedItem: { item: i },
                    });
                } else {
                    throw new NodeApiError(this.getNode(), error as JsonObject);
                }
            }
        }

        return [returnData];
    }
}
