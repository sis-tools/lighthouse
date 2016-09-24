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

const UsesHTTP2Audit = require('../../../audits/dobetterweb/uses-http2.js');
const assert = require('assert');

/* eslint-env mocha */

describe('Resources are fetched over http/2', () => {
  it('fails when no input present', () => {
    const auditResult = UsesHTTP2Audit.audit({});
    assert.equal(auditResult.rawValue, -1);
    assert.ok(auditResult.debugString);
  });

  it('fails when some resources were requested via http/1.x', () => {
    const auditResult = UsesHTTP2Audit.audit({
      SameOriginResources: [
        {url: 'http://example.com/one', protocol: 'http/1.1'},
        {url: 'http://example.com/two', protocol: 'http/1.0'}
      ]
    });
    assert.equal(auditResult.rawValue, false);
    assert.ok(auditResult.displayValue.match('2 resources were not'));
  });

  it('passes when all resources were requested via http/2', () => {
    const auditResult = UsesHTTP2Audit.audit({
      SameOriginResources: [
        {url: 'http://example.com/one', protocol: 'h2'},
        {url: 'http://example.com/two', protocol: 'h2'}
      ]
    });
    assert.equal(auditResult.rawValue, true);
    assert.ok(auditResult.displayValue === '');
  });
});
