/**
 * Copyright 2016 Google Inc. All rights reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
'use strict';

const Runner = require('../runner');
const fakeDriver = require('./gather/fake-driver');
const Config = require('../config/config');
const Audit = require('../audits/audit');
const assert = require('assert');
const path = require('path');

/* eslint-env mocha */

describe('Runner', () => {
  it('expands gatherers', () => {
    const url = 'https://example.com';
    const config = new Config({
      passes: [{
        gatherers: ['https']
      }],
      audits: [
        'is-on-https'
      ]
    });

    return Runner.run(fakeDriver, {url, config}).then(_ => {
      assert.ok(typeof config.passes[0].gatherers[0] === 'object');
    });
  });

  it('rejects when given neither passes nor artifacts', () => {
    const url = 'https://example.com';
    const config = new Config({
      audits: [
        'is-on-https'
      ]
    });

    return Runner.run(fakeDriver, {url, config})
      .then(_ => {
        assert.ok(false);
      }, err => {
        assert.ok(/The config must provide passes/.test(err.message));
      });
  });

  it('accepts existing artifacts', () => {
    const url = 'https://example.com';
    const config = new Config({
      audits: [
        'is-on-https'
      ],

      artifacts: {
        HTTPS: {
          value: true
        }
      }
    });

    return Runner.run({}, {url, config}).then(results => {
      // Mostly checking that this did not throw, but check representative values.
      assert.equal(results.initialUrl, url);
      assert.strictEqual(results.audits['is-on-https'].rawValue, true);
    });
  });

  it('accepts trace artifacts as paths and outputs appropriate data', () => {
    const url = 'https://example.com';

    const config = new Config({
      audits: [
        'user-timings'
      ],

      artifacts: {
        traces: {
          [Audit.DEFAULT_PASS]: path.join(__dirname, '/fixtures/traces/trace-user-timings.json')
        }
      }
    });

    return Runner.run({}, {url, config}).then(results => {
      const audits = results.audits;
      assert.equal(audits['user-timings'].rawValue, 2);
    });
  });

  it('fails gracefully with empty artifacts object', () => {
    const url = 'https://example.com';

    const config = new Config({
      audits: [
        'user-timings'
      ],

      artifacts: {
      }
    });

    return Runner.run({}, {url, config}).then(results => {
      const audits = results.audits;
      assert.equal(audits['user-timings'].rawValue, -1);
      assert(audits['user-timings'].debugString);
    });
  });

  it('accepts performance logs as an artifact', () => {
    const url = 'https://example.com';
    const config = new Config({
      audits: [
        'critical-request-chains'
      ],

      artifacts: {
        performanceLog: path.join(__dirname, '/fixtures/perflog.json')
      }
    });

    return Runner.run({}, {url, config}).then(results => {
      const audits = results.audits;
      assert.equal(audits['critical-request-chains'].rawValue, 9);
    });
  });

  it('rejects when given neither audits nor auditResults', () => {
    const url = 'https://example.com';
    const config = new Config({
      passes: [{
        gatherers: ['https']
      }]
    });

    return Runner.run(fakeDriver, {url, config})
      .then(_ => {
        assert.ok(false);
      }, err => {
        assert.ok(/The config must provide passes/.test(err.message));
      });
  });

  it('accepts existing auditResults', () => {
    const url = 'https://example.com';
    const config = new Config({
      auditResults: [{
        name: 'is-on-https',
        rawValue: true,
        score: true,
        displayValue: ''
      }],

      aggregations: [{
        name: 'Aggregation',
        description: '',
        scored: true,
        categorizable: true,
        items: [{
          name: 'name',
          description: 'description',
          audits: {
            'is-on-https': {
              expectedValue: true,
              weight: 1
            }
          }
        }]
      }]
    });

    return Runner.run(fakeDriver, {url, config}).then(results => {
      // Mostly checking that this did not throw, but check representative values.
      assert.equal(results.initialUrl, url);
      assert.strictEqual(results.audits['is-on-https'].rawValue, true);
    });
  });

  it('returns an aggregation', () => {
    const url = 'https://example.com';
    const config = new Config({
      auditResults: [{
        name: 'is-on-https',
        rawValue: true,
        score: true,
        displayValue: ''
      }],

      aggregations: [{
        name: 'Aggregation',
        description: '',
        scored: true,
        categorizable: true,
        items: [{
          name: 'name',
          description: 'description',
          audits: {
            'is-on-https': {
              expectedValue: true,
              weight: 1
            }
          }
        }]
      }]
    });

    return Runner.run(fakeDriver, {url, config}).then(results => {
      assert.ok(results.lighthouseVersion);
      assert.equal(results.initialUrl, url);
      assert.equal(results.audits['is-on-https'].name, 'is-on-https');
      assert.equal(results.aggregations[0].score[0].overall, 1);
      assert.equal(results.aggregations[0].score[0].subItems[0], 'is-on-https');
    });
  });

  it('rejects when not given a URL', () => {
    return Runner.run({}, {}).then(_ => assert.ok(false), _ => assert.ok(true));
  });

  it('rejects when given a URL of zero length', () => {
    return Runner.run({}, {url: ''}).then(_ => assert.ok(false), _ => assert.ok(true));
  });

  it('rejects when given a URL without protocol', () => {
    return Runner.run({}, {url: 'localhost'}).then(_ => assert.ok(false), _ => assert.ok(true));
  });

  it('rejects when given a URL without hostname', () => {
    return Runner.run({}, {url: 'https://'}).then(_ => assert.ok(false), _ => assert.ok(true));
  });
});
