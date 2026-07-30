const axios = require('axios');

const GLM_URL = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';

// In-memory rate limit tracker: last successful call timestamp
let _lastCall = 0;
const MIN_INTERVAL_MS = 3000; // Minimum 3 seconds between API calls to avoid 429

/**
 * Sleep for ms milliseconds
 */
function sleep(ms) {
	return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Send a chat completion request to GLM with automatic retry on 429 (rate limit).
 * Retries up to 3 times with exponential backoff (4s, 8s, 16s).
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} options - Optional: { model, temperature, maxRetries, skipRateLimit }
 * @returns {Promise<string>} The assistant's reply text
 */
async function chat(messages, options = {}) {
	const key = process.env.GLM_API_KEY;
	if (!key) throw new Error('GLM_API_KEY not set in environment');

	const maxRetries = options.maxRetries ?? 3;

	// Self-imposed rate limiting: wait if we called too recently
	if (!options.skipRateLimit) {
		const elapsed = Date.now() - _lastCall;
		if (elapsed < MIN_INTERVAL_MS) {
			await sleep(MIN_INTERVAL_MS - elapsed);
		}
	}

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			const response = await axios.post(GLM_URL, {
				model: options.model || 'glm-4-plus',
				messages,
				temperature: options.temperature ?? 0.85,
				max_tokens: options.maxTokens || 1024
			}, {
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${key}`
				},
				timeout: 45000
			});

			_lastCall = Date.now();
			return response.data.choices?.[0]?.message?.content || '';

		} catch (err) {
			const status = err.response?.status;
			const isRateLimit = status === 429;
			const isServerError = status >= 500 && status < 600;

			// Only retry on 429 (rate limit) or 5xx (server error)
			if ((isRateLimit || isServerError) && attempt < maxRetries) {
				const backoff = Math.min(4000 * Math.pow(2, attempt), 20000); // 4s, 8s, 16s cap
				console.log(`[glmApi] ${isRateLimit ? 'Rate limited' : 'Server error'} (${status}), retry ${attempt + 1}/${maxRetries} in ${backoff}ms...`);
				await sleep(backoff);
				continue;
			}

			// Non-retryable error — throw with friendly message
			if (isRateLimit) {
				throw new Error('Rate limited by GLM API. Wait about 30 seconds before trying ,cc again.');
			}
			if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
				throw new Error('GLM API timed out. Try again in a moment.');
			}
			if (status === 401) {
				throw new Error('GLM API key is invalid or expired. Check GLM_API_KEY on Railway.');
			}
			if (status === 400) {
				const detail = err.response?.data?.error?.message || '';
				throw new Error(`GLM API bad request: ${detail}`);
			}

			// Unknown error — pass through
			throw new Error(`GLM API error: ${err.message}`);
		}
	}

	throw new Error('GLM API: Max retries reached. Try again later.');
}

module.exports = { chat };
