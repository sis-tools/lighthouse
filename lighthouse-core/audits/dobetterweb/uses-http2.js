/**
 * @license
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

/**
 * @fileoverview Audit a page to ensure that resource loaded over its own
 * origin are over the http/2 protocol.
 */

'use strict';

const Audit = require('../audit');
const Formatter = require('../../formatters/formatter');

class UsesHTTP2Audit extends Audit {

  /**
   * @return {!AuditMeta}
   */
  static get meta() {
    return {
      category: 'Performance',
      name: 'uses-http2',
      // optimalValue: 0,
      description: 'Site resources use HTTP/2',
      requiredArtifacts: ['HTTP2Resources']
    };
  }

  /**
   * @param {!Artifacts} artifacts
   * @return {!AuditResult}
   */
  static audit(artifacts) {

    const resources = artifacts.HTTP2Resources;
    const displayValue = (resources.length ?
        `${resources.length} resources are not served over h2` : '');

    return UsesHTTP2Audit.generateAuditResult({
      rawValue: resources.length === 0,
      displayValue: displayValue,
      extendedInfo: {
        formatter: Formatter.SUPPORTED_FORMATS.URLLIST,
        value: resources
      }
    });
  }
}

module.exports = UsesHTTP2Audit;
