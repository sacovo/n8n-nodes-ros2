import { configWithoutCloudSupport } from '@n8n/node-cli/eslint';

export default [
	...configWithoutCloudSupport,
	{
		rules: {
			'n8n-nodes-base/node-param-display-name-miscased': 'off',
		},
	},
];
