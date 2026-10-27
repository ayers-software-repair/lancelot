// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import OpenAI from 'openai';
import type { LoggerService } from './logger.js';
import type { ConfigurationService } from './config.js';

export class EmbeddingsService {
  private openai?: OpenAI;
  private logger?: LoggerService;
  private configService: ConfigurationService;
  readonly model: string;
  readonly dimensions: number;

  constructor(configService: ConfigurationService, logger?: LoggerService) {
    this.configService = configService;
    this.logger = logger;

    const { embeddings } = configService.getConfig();
    this.model = embeddings.model;
    this.dimensions = embeddings.dimensions;
  }

  /** Creates the OpenAI client when a key is available. Without one, search is text only. */
  async initialize(): Promise<void> {
    const apiKey = await this.configService.getApiKey('openai');

    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      this.logger?.info('Embeddings available', { provider: 'openai', model: this.model });
    } else {
      this.logger?.info('No OpenAI API key set. Search uses text matching.');
    }
  }

  /** The embedding for a text, or null when no client exists or the request fails. */
  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.openai) {
      return null;
    }

    try {
      const response = await this.openai.embeddings.create({ model: this.model, input: text });
      return response.data[0]?.embedding ?? null;
    } catch (error) {
      this.logger?.error('Failed to generate embedding', {
        error,
        model: this.model,
        textLength: text.length,
      });
      return null;
    }
  }

  isAvailable(): boolean {
    return this.openai !== undefined;
  }

  getModelInfo(): { model: string; dimensions: number; available: boolean } {
    return { model: this.model, dimensions: this.dimensions, available: this.isAvailable() };
  }
}
