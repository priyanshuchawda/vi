// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';
import {
  buildGeminiGenerateContentRequest,
  converseWithProviderFallback,
  DEFAULT_GEMINI_MODEL_ID,
  translateGeminiResponseToBedrock,
} from '../../electron/services/geminiFallbackService.js';

describe('geminiFallbackService', () => {
  it('maps Bedrock-style messages, tools, and tool results into a Gemini request', () => {
    const request = buildGeminiGenerateContentRequest(
      {
        system: [{ text: 'You are a concise editor.' }],
        messages: [
          {
            role: 'user',
            content: [
              {
                image: {
                  format: 'jpeg',
                  source: { bytes: Uint8Array.from([0xde, 0xad, 0xbe, 0xef]) },
                },
              },
              { text: 'Inspect the current frame.' },
            ],
          },
          {
            role: 'assistant',
            content: [
              {
                toolUse: {
                  toolUseId: 'tool-1',
                  name: 'get_timeline_info',
                  input: {},
                },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                toolResult: {
                  toolUseId: 'tool-1',
                  content: [{ json: { clips: [{ id: 'clip-1' }] } }],
                },
              },
            ],
          },
        ],
        inferenceConfig: {
          maxTokens: 256,
          temperature: 0.2,
          topP: 0.9,
          stopSequences: ['</done>'],
        },
        toolConfig: {
          tools: [
            {
              toolSpec: {
                name: 'get_timeline_info',
                description: 'Return timeline details.',
                inputSchema: {
                  json: {
                    type: 'object',
                    properties: {},
                  },
                },
              },
            },
          ],
        },
      },
      { geminiModelId: '' },
    );

    const contents = request.contents as Array<{ role?: string; parts?: Array<Record<string, any>> }>;

    expect(request.model).toBe(DEFAULT_GEMINI_MODEL_ID);
    expect(request.config?.systemInstruction).toBe('You are a concise editor.');
    expect(request.config?.maxOutputTokens).toBe(256);
    expect(request.config?.temperature).toBe(0.2);
    expect(request.config?.topP).toBe(0.9);
    expect(request.config?.stopSequences).toEqual(['</done>']);
    const firstTool = request.config?.tools?.[0] as any;
    expect(firstTool?.functionDeclarations?.[0]?.name).toBe('get_timeline_info');
    expect(contents[0]?.role).toBe('user');
    expect(contents[0]?.parts?.[0]?.inlineData).toMatchObject({
      mimeType: 'image/jpeg',
      data: '3q2+7w==',
    });
    expect(contents[1]?.role).toBe('model');
    expect(contents[1]?.parts?.[0]?.functionCall).toMatchObject({
      id: 'tool-1',
      name: 'get_timeline_info',
      args: {},
    });
    expect(contents[2]?.parts?.[0]?.functionResponse).toMatchObject({
      id: 'tool-1',
      name: 'get_timeline_info',
      response: { clips: [{ id: 'clip-1' }] },
    });
  });

  it('translates Gemini responses back into the Bedrock-like envelope', () => {
    const response = translateGeminiResponseToBedrock({
      candidates: [
        {
          content: {
            role: 'model',
            parts: [
              {
                functionCall: {
                  id: 'gem-call-1',
                  name: 'split_clip',
                  args: { clip_id: 'clip-1', time_in_clip: 4.2 },
                },
              },
              { text: 'I am ready to split the clip.' },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 120,
        candidatesTokenCount: 18,
        totalTokenCount: 138,
      },
      modelVersion: 'gemini-2.5-flash-lite',
    } as any);

    expect(response.stopReason).toBe('tool_use');
    expect(response.usage).toEqual({
      inputTokens: 120,
      outputTokens: 18,
      totalTokens: 138,
    });
    const output = response.output as any;
    expect(output?.message?.content?.[0]).toEqual({
      toolUse: {
        toolUseId: 'gem-call-1',
        name: 'split_clip',
        input: { clip_id: 'clip-1', time_in_clip: 4.2 },
      },
    });
    expect(output?.message?.content?.[1]).toEqual({
      text: 'I am ready to split the clip.',
    });
  });

  it('uses Gemini directly when Bedrock credentials are absent but Gemini is configured', async () => {
    const sendBedrock = vi.fn();
    const sendGemini = vi.fn().mockResolvedValue({
      stopReason: 'end_turn',
      output: { message: { content: [{ text: 'Gemini answered.' }] } },
    });

    const result = await converseWithProviderFallback({
      commandInput: { messages: [] },
      settings: {
        awsAccessKeyId: '',
        awsSecretAccessKey: '',
        geminiApiKey: 'gem-key',
        geminiModelId: 'gemini-2.5-flash-lite',
      },
      sendBedrock,
      sendGemini,
    });

    expect(result.provider).toBe('gemini');
    expect(sendBedrock).not.toHaveBeenCalled();
    expect(sendGemini).toHaveBeenCalledOnce();
  });

  it('falls back to Gemini on Bedrock transport/auth failures but not on unrelated request errors', async () => {
    const sendGemini = vi.fn().mockResolvedValue({
      stopReason: 'end_turn',
      output: { message: { content: [{ text: 'Gemini fallback reply.' }] } },
    });

    const fallbackResult = await converseWithProviderFallback({
      commandInput: { messages: [] },
      settings: {
        awsAccessKeyId: 'aws-key',
        awsSecretAccessKey: 'aws-secret',
        geminiApiKey: 'gem-key',
        geminiModelId: 'gemini-2.5-flash-lite',
      },
      sendBedrock: vi
        .fn()
        .mockRejectedValue(new Error('Bedrock endpoint unreachable (bedrock-runtime.eu-central-1.amazonaws.com).')),
      sendGemini,
    });

    expect(fallbackResult.provider).toBe('gemini');
    expect(sendGemini).toHaveBeenCalledOnce();

    await expect(
      converseWithProviderFallback({
        commandInput: { messages: [] },
        settings: {
          awsAccessKeyId: 'aws-key',
          awsSecretAccessKey: 'aws-secret',
          geminiApiKey: 'gem-key',
          geminiModelId: 'gemini-2.5-flash-lite',
        },
        sendBedrock: vi
          .fn()
          .mockRejectedValue(new Error('ValidationException: malformed request payload')),
        sendGemini,
      }),
    ).rejects.toThrow('ValidationException: malformed request payload');
  });
});
