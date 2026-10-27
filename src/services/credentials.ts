// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Credential storage. The OS keychain through keytar when it loads, an encrypted
 * file through conf when it does not.
 */
import Conf from 'conf';
import { createHash } from 'node:crypto';
import { cpus, totalmem } from 'node:os';
import type { LoggerService } from './logger.js';
import { MISC, CREDENTIALS_LOG_MESSAGES } from '../config/constants.js';

type Keytar = typeof import('keytar');

export type StorageBackend = typeof MISC.KEYTAR_BACKEND | typeof MISC.CONF_BACKEND;

interface CredentialMetadata {
  backend: StorageBackend;
  lastUpdated: string;
}

export class CredentialService {
  private conf: Conf<Record<string, string>>;
  private metaConf: Conf<Record<string, CredentialMetadata>>;
  private keytar?: Keytar;
  private keytarLoaded: Promise<void>;
  private logger?: LoggerService;

  constructor(logger?: LoggerService, options?: { cwd?: string }) {
    this.logger = logger;
    const cwd = options?.cwd;

    this.conf = new Conf<Record<string, string>>({
      projectName: MISC.SERVICE_NAME,
      configName: MISC.CREDENTIALS_CONFIG_NAME,
      encryptionKey: this.generateEncryptionKey(),
      clearInvalidConfig: true,
      ...(cwd ? { cwd } : {}),
    });
    this.metaConf = new Conf<Record<string, CredentialMetadata>>({
      projectName: MISC.SERVICE_NAME,
      configName: MISC.CREDENTIALS_META_CONFIG_NAME,
      clearInvalidConfig: true,
      ...(cwd ? { cwd } : {}),
    });

    this.keytarLoaded = this.loadKeytar();
  }

  private async loadKeytar(): Promise<void> {
    try {
      // keytar is CommonJS: under native ESM its functions sit on `default`.
      const mod = (await import('keytar')) as Keytar & { default?: Keytar };
      this.keytar = mod.default ?? mod;
      this.logger?.debug(CREDENTIALS_LOG_MESSAGES.KEYTAR_LOADED);
    } catch {
      this.logger?.debug(CREDENTIALS_LOG_MESSAGES.KEYTAR_NOT_AVAILABLE);
    }
  }

  /** A key tied to this machine and user. It keeps the file from being read when copied away. */
  private generateEncryptionKey(): string {
    const hostname = process.env.COMPUTERNAME ?? process.env.HOSTNAME ?? MISC.DEFAULT_HOSTNAME;
    const username = process.env.USERNAME ?? process.env.USER ?? MISC.DEFAULT_USERNAME;
    const { platform, arch } = process;
    const entropy = [
      MISC.SERVICE_NAME,
      hostname,
      username,
      platform,
      arch,
      String(cpus().length),
      String(totalmem()),
    ].join('-');
    return createHash('sha256').update(entropy).digest('hex').substring(0, 32);
  }

  private markBackend(key: string, backend: StorageBackend): void {
    this.metaConf.set(key, { backend, lastUpdated: new Date().toISOString() });
  }

  /** Stores the value and returns the backend that took it. */
  async setCredential(key: string, value: string): Promise<StorageBackend> {
    await this.keytarLoaded;

    if (this.keytar) {
      try {
        await this.keytar.setPassword(MISC.SERVICE_NAME, key, value);
        this.markBackend(key, MISC.KEYTAR_BACKEND);
        this.conf.delete(key);
        return MISC.KEYTAR_BACKEND;
      } catch (error) {
        this.logger?.warn('keytar failed, falling back to the config file', { error });
      }
    }

    this.conf.set(key, value);
    this.markBackend(key, MISC.CONF_BACKEND);
    return MISC.CONF_BACKEND;
  }

  async getCredential(key: string): Promise<string | null> {
    await this.keytarLoaded;

    const fromFile = this.conf.get(key);
    if (this.metaConf.get(key)?.backend !== MISC.KEYTAR_BACKEND && fromFile) {
      return fromFile;
    }

    if (this.keytar) {
      try {
        const value = await this.keytar.getPassword(MISC.SERVICE_NAME, key);
        if (value) {
          return value;
        }
      } catch (error) {
        this.logger?.warn('keytar read failed', { error });
      }
    }

    return fromFile || null;
  }
}
