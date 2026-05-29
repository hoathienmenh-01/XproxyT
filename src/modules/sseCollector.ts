export function collectNonStreamFromTransformedSSE(
  stream: NodeJS.ReadableStream,
  model: string,
): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let id = '';
    let content = '';
    let reasoningContent = '';
    let finishReason = 'stop';
    const toolCalls: any[] = [];
    // Track real token usage from stream chunks
    let capturedUsage: { prompt_tokens: number; completion_tokens: number; total_tokens: number } | null = null;

    const flushLine = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === '[DONE]') return;
      try {
        const chunk = JSON.parse(payload);
        if (chunk.id) id = chunk.id;
        const choice = chunk?.choices?.[0];
        const delta = choice?.delta || {};
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
        }
        if (typeof delta.reasoning_content === 'string' && delta.reasoning_content) {
          reasoningContent += delta.reasoning_content;
        }
        if (Array.isArray(delta.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const index = typeof tc?.index === 'number' ? tc.index : toolCalls.length;
            const existing = toolCalls[index] || { index };
            toolCalls[index] = {
              ...existing,
              ...tc,
              function: {
                ...(existing.function || {}),
                ...(tc.function || {}),
                name: tc.function?.name ?? existing.function?.name,
                arguments: `${existing.function?.arguments || ''}${tc.function?.arguments || ''}`,
              },
            };
          }
        }
        if (choice?.finish_reason) {
          finishReason = choice.finish_reason;
        }
        // Capture real token usage if present in any chunk
        if (chunk.usage && typeof chunk.usage === 'object') {
          const u = chunk.usage;
          const pt = Number(u.prompt_tokens) || 0;
          const ct = Number(u.completion_tokens) || 0;
          const tt = Number(u.total_tokens) || 0;
          if (pt > 0 || ct > 0 || tt > 0) {
            capturedUsage = {
              prompt_tokens: pt,
              completion_tokens: ct,
              total_tokens: tt || (pt + ct),
            };
          }
        }
      } catch {
      }
    };

    stream.on('data', (chunk: Buffer | string) => {
      buffer += chunk.toString();
      let idx = buffer.indexOf('\n');
      while (idx >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        flushLine(line);
        idx = buffer.indexOf('\n');
      }
    });

    stream.once('error', err => reject(err));
    stream.once('end', () => {
      const message: any = {
        role: 'assistant',
        content: content || '',
        reasoning_content: reasoningContent || '',
      };
      const compactToolCalls = toolCalls.filter(Boolean);
      if (compactToolCalls.length > 0) {
        message.content = content || null;
        message.tool_calls = compactToolCalls;
      }

      // Use real captured usage if available, otherwise use fallback
      const finalUsage = capturedUsage || {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2};

      resolve({
        id: id || '',
        model,
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            message,
            finish_reason: finishReason || 'stop',
          },
        ],
        usage: finalUsage,
        created: Math.floor(Date.now() / 1000),
      });
    });
  });
}
