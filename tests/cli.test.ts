// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { csvList, parseCli } from '../src/core/cli.js';

describe('parseCli', () => {
  it('stays on stdio without --http', () => {
    expect(parseCli([], {})).toEqual({});
    expect(parseCli(['--something-else'], {})).toEqual({});
  });

  it('serves HTTP on 127.0.0.1:3000 by default, allowing only loopback hosts', () => {
    expect(parseCli(['--http'], {}).http).toEqual({
      port: 3000,
      host: '127.0.0.1',
      allowedOrigins: [],
      allowedHosts: ['127.0.0.1:3000', 'localhost:3000', '[::1]:3000'],
    });
  });

  it('takes a port as the next word or after =', () => {
    expect(parseCli(['--http', '8080'], {}).http?.port).toBe(8080);
    expect(parseCli(['--http=9000'], {}).http?.port).toBe(9000);
    expect(parseCli(['--http', '--host', '0.0.0.0'], {}).http?.port).toBe(3000);
  });

  it('binds another address only when --host says so, with no host check unless listed', () => {
    const open = parseCli(['--http', '--host', '0.0.0.0'], {}).http;
    expect(open).toMatchObject({ host: '0.0.0.0', allowedHosts: [] });
    const listed = parseCli(['--http', '--host=0.0.0.0'], { LANCELOT_ALLOWED_HOSTS: 'ayers.repair' });
    expect(listed.http?.allowedHosts).toEqual(['ayers.repair']);
  });

  it('reads the allow lists from the environment', () => {
    const env = {
      LANCELOT_ALLOWED_ORIGINS: ' https://a.example , https://b.example,, ',
      LANCELOT_ALLOWED_HOSTS: 'localhost:3000',
    };
    expect(parseCli(['--http'], env).http).toMatchObject({
      allowedOrigins: ['https://a.example', 'https://b.example'],
      allowedHosts: ['localhost:3000'],
    });
  });

  it('refuses a bad port, and --host without --http', () => {
    expect(() => parseCli(['--http', '0'], {})).toThrow('port');
    expect(() => parseCli(['--http', '70000'], {})).toThrow('port');
    expect(() => parseCli(['--http', 'abc'], {})).toThrow('port');
    expect(() => parseCli(['--host', '0.0.0.0'], {})).toThrow('--http');
    expect(() => parseCli(['--http', '--host'], {})).toThrow('address');
  });
});

describe('csvList', () => {
  it('drops blanks and treats an unset or blank variable as none', () => {
    expect(csvList(undefined)).toEqual([]);
    expect(csvList('   ')).toEqual([]);
    expect(csvList('a, b,,c')).toEqual(['a', 'b', 'c']);
  });
});
