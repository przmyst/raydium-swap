module.exports = {
	env: {
		commonjs: true,
		es2021: true,
		node: true
	},
	extends: 'eslint:recommended',
	parserOptions: {
		ecmaVersion: 12
	},
	rules: {
		'quote-props': [
			'error',
			'as-needed'
		],
		semi: [
			'error',
			'never'
		],
		quotes: [
			'error',
			'single'
		],
		indent: [
			'error',
			'tab'
		],
		'array-element-newline': ['error', {
			ArrayExpression: 'consistent',
			ArrayPattern: {
				minItems: 6
			}
		}],
		'object-property-newline': ['error', {
			allowAllPropertiesOnSameLine: false
		}],
		'no-multiple-empty-lines': ['error', {
			max: 1,
			maxEOF: 1
		}],
		'object-curly-newline': ['error', 'always']
	}
}

