/**
 * GLM API — Calls Zhipu AI GLM-4-Plus directly via REST
 * API key is read from process.env.GLM_API_KEY (set on Railway, never in repo)
 */

const axios = require('axios');

const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

/**
 * Send a chat completion request to GLM.
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} options - Optional: { model, temperature }
 * @returns {Promise<string>} The assistant's reply text
 */
async function chat(messages, options = {}) {
	const key = process.env.GLM_API_KEY;
	if (!key) throw new Error('GLM_API_KEY not set in environment');

	const response = await axios.post(GLM_URL, {
		model: options.model || 'glm-4-plus',
		messages,
		temperature: options.temperature ?? 0.85,
		max_tokens: 1024
	}, {
		headers: {
			'Content-Type': 'application/json',
			'Authorization': `Bearer ${key}`
		},
		timeout: 30000
	});

	return response.data.choices?.[0]?.message?.content || '';
}

module.exports = { chat };
